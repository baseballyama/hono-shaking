// Walk a repository, find every Hono server / hc client, and pair them up by
// resolving each `hc<T>(...)` type argument through the TypeScript Compiler
// API. The output is a flat list of (server, clientVariable) bindings that
// the analysis pipeline can run a diff over.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

import { extractRoutes } from './extract-routes.ts';
import { loadProgram } from './ts-program.ts';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.turbo',
  '.vercel',
  '.netlify',
  '.output',
]);

const isTsFile = (p: string): boolean =>
  (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.d.ts');

const walkSourceFiles = (root: string): string[] => {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir == null) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      // Skip dotfiles / dotdirs (e.g. `.changeset`, `.github`, editor scratch
      // dirs). They're virtually never the location of application source.
      if (name.startsWith('.') && name !== '.' && name !== '..') continue;
      const p = join(dir, name);
      let s: ReturnType<typeof statSync>;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        stack.push(p);
      } else if (s.isFile() && isTsFile(p)) {
        out.push(p);
      }
    }
  }
  return out;
};

/** Walk up from `file` toward `root` until a sibling of name `name` is found. */
const findNearest = (file: string, root: string, name: string): string | null => {
  let dir = dirname(file);
  const absRoot = resolve(root);
  while (true) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    if (dir === absRoot || dir.length <= absRoot.length) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

// `export type X = typeof Y` — narrow enough to skip re-exports and shadow declarations.
const SERVER_TYPE_RE = /export\s+type\s+(\w+)\s*=\s*typeof\s+\w+/g;
// `hc<X>(...)` — captures the type argument. We deliberately don't require an
// `import { hc } from 'hono/client'` line because real-world projects re-export
// `hc` from their own client barrel (`@org/backend/client`), and a literal
// import check would miss those.
const HC_CALL_RE = /\bhc\s*<\s*(\w+)\s*>\s*\(/g;
const HONO_IMPORT_RE = /from\s+['"]hono(?:\/[\w-]+)?['"]/;

interface RawServerCandidate {
  file: string;
  exportName: string;
}

const detectServerCandidates = (files: string[]): RawServerCandidate[] => {
  const out: RawServerCandidate[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!HONO_IMPORT_RE.test(content)) continue;
    for (const m of content.matchAll(SERVER_TYPE_RE)) {
      const exportName = m[1];
      if (exportName != null) out.push({ file, exportName });
    }
  }
  return out;
};

interface RawClientCandidate {
  file: string;
  usedTypes: string[];
}

const detectClientCandidates = (files: string[]): RawClientCandidate[] => {
  const out: RawClientCandidate[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const usedTypes = new Set<string>();
    for (const m of content.matchAll(HC_CALL_RE)) {
      if (m[1] != null) usedTypes.add(m[1]);
    }
    if (usedTypes.size > 0) out.push({ file, usedTypes: [...usedTypes] });
  }
  return out;
};

export interface DiscoveredServer {
  appTypeFile: string;
  exportName: string;
  tsconfigPath: string;
  packageDir: string;
  routeCount: number;
}

/**
 * Keep only candidates for which `extractRoutes` actually succeeds. The regex
 * catches `export type X = typeof Y` shapes that aren't Hono apps (e.g.
 * `typeof someConfig`); the real type-checker pass rejects them.
 */
const validateServers = (candidates: RawServerCandidate[], root: string): DiscoveredServer[] => {
  const out: DiscoveredServer[] = [];
  for (const c of candidates) {
    const tsconfigPath = findNearest(c.file, root, 'tsconfig.json');
    if (tsconfigPath == null) continue;
    try {
      const routes = extractRoutes({
        tsconfigPath,
        appTypeFile: c.file,
        exportName: c.exportName,
      });

      if (routes.length === 0) continue;
      const pkg = findNearest(c.file, root, 'package.json');
      const packageDir = pkg == null ? dirname(c.file) : dirname(pkg);
      out.push({
        appTypeFile: c.file,
        exportName: c.exportName,
        tsconfigPath,
        packageDir,
        routeCount: routes.length,
      });
    } catch {
      // Not a Hono AppType (or unresolvable). Skip without logging — many
      // false positives are expected from the regex pass.
    }
  }
  return out;
};

export interface ResolvedBinding {
  clientFile: string;
  clientPackageDir: string;
  clientTsconfigPath: string;
  /** Variable name the binding is exposed as (e.g. `backendClient`). */
  variableName: string;
  server: DiscoveredServer;
}

/**
 * Resolve `hc<T>(...)`'s type argument to its declaration file via the TS
 * checker, then match against a discovered server by (file, export name).
 */
const resolveAppTypeServer = (
  typeArg: ts.TypeNode | undefined,
  checker: ts.TypeChecker,
  servers: DiscoveredServer[],
): DiscoveredServer | null => {
  if (typeArg == null || !ts.isTypeReferenceNode(typeArg)) return null;
  let symbol = checker.getSymbolAtLocation(typeArg.typeName);
  if (symbol == null) return null;
  // `import type { AppType }` produces an alias symbol; chase it to the
  // declaration symbol so we land on the actual `export type` site.
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const decl = symbol.declarations?.[0];
  if (decl == null) return null;
  const declFile = resolve(decl.getSourceFile().fileName);
  const exportName = symbol.name;
  return (
    servers.find((s) => resolve(s.appTypeFile) === declFile && s.exportName === exportName) ?? null
  );
};

interface HcCallSiteContext {
  /** `const X = hc<T>(...)` → variable name. */
  variableName: string | null;
  /**
   * `const F = (...) => hc<T>(...)` / `function F() { return hc<T>(...) }` →
   * factory function name. Consumers of this factory will be discovered in a
   * second pass.
   */
  factoryName: string | null;
}

const classifyHcCallContext = (node: ts.CallExpression): HcCallSiteContext => {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor != null) {
    if (ts.isVariableDeclaration(cursor)) {
      if (cursor.initializer === node && ts.isIdentifier(cursor.name)) {
        return { variableName: cursor.name.text, factoryName: null };
      }
      break;
    }
    if (ts.isFunctionDeclaration(cursor) && cursor.name != null) {
      return { variableName: null, factoryName: cursor.name.text };
    }
    if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
      const parent = cursor.parent;
      if (parent != null && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return { variableName: null, factoryName: parent.name.text };
      }
      return { variableName: null, factoryName: null };
    }
    if (ts.isMethodDeclaration(cursor) && ts.isIdentifier(cursor.name)) {
      return { variableName: null, factoryName: cursor.name.text };
    }
    cursor = cursor.parent;
  }
  return { variableName: null, factoryName: null };
};

interface FactoryInfo {
  declFile: string;
  server: DiscoveredServer;
}

/**
 * For each client candidate, run a typed pass to record direct bindings and
 * factory definitions. Then do an untyped pass across the whole repo to find
 * consumers of those factories — those consumers wouldn't show up as
 * candidates because they don't contain `hc<...>(...)` themselves.
 */
const linkClients = (
  clients: RawClientCandidate[],
  servers: DiscoveredServer[],
  root: string,
  allTsFiles: string[],
): ResolvedBinding[] => {
  const bindings: ResolvedBinding[] = [];
  const factoryByName = new Map<string, FactoryInfo>();

  const byTsconfig = new Map<string, RawClientCandidate[]>();
  for (const c of clients) {
    const tsconfigPath = findNearest(c.file, root, 'tsconfig.json');
    if (tsconfigPath == null) continue;
    let group = byTsconfig.get(tsconfigPath);
    if (group == null) {
      group = [];
      byTsconfig.set(tsconfigPath, group);
    }
    group.push(c);
  }

  for (const [tsconfigPath, group] of byTsconfig) {
    let program: ts.Program;
    let checker: ts.TypeChecker;
    try {
      const loaded = loadProgram(tsconfigPath);
      program = loaded.program;
      checker = loaded.checker;
    } catch (err) {
      console.warn(`hono-shaking: skip tsconfig ${tsconfigPath}: ${String(err)}`);
      continue;
    }

    for (const client of group) {
      const absClient = resolve(client.file);
      const sf = program.getSourceFiles().find((s) => resolve(s.fileName) === absClient);
      if (sf == null) continue;

      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'hc'
        ) {
          const server = resolveAppTypeServer(node.typeArguments?.[0], checker, servers);
          if (server != null) {
            const ctx = classifyHcCallContext(node);
            if (ctx.variableName != null) {
              const pkg = findNearest(client.file, root, 'package.json');
              const clientPackageDir = pkg == null ? dirname(client.file) : dirname(pkg);
              bindings.push({
                clientFile: client.file,
                clientPackageDir,
                clientTsconfigPath: tsconfigPath,
                variableName: ctx.variableName,
                server,
              });
            } else if (ctx.factoryName != null) {
              factoryByName.set(ctx.factoryName, { declFile: client.file, server });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  if (factoryByName.size > 0) {
    const factoryNames = [...factoryByName.keys()];
    for (const file of allTsFiles) {
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      // Quick string-level pre-filter — most files won't mention any factory.
      if (!factoryNames.some((name) => content.includes(name))) continue;
      const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const tsconfigPath = findNearest(file, root, 'tsconfig.json');
      if (tsconfigPath == null) continue;
      const pkg = findNearest(file, root, 'package.json');
      const clientPackageDir = pkg == null ? dirname(file) : dirname(pkg);

      const visit = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          node.initializer != null &&
          ts.isIdentifier(node.name) &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression)
        ) {
          const calleeName = node.initializer.expression.text;
          const factory = factoryByName.get(calleeName);
          if (factory != null) {
            bindings.push({
              clientFile: file,
              clientPackageDir,
              clientTsconfigPath: tsconfigPath,
              variableName: node.name.text,
              server: factory.server,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }

  return bindings;
};

export interface DiscoveryResult {
  servers: DiscoveredServer[];
  bindings: ResolvedBinding[];
  /** Raw regex-stage candidates, kept for diagnostics (`--list` / debug). */
  unresolved: {
    serverCandidates: RawServerCandidate[];
    clientCandidates: RawClientCandidate[];
  };
}

export const discoverProject = (root: string): DiscoveryResult => {
  const absRoot = resolve(root);
  const files = walkSourceFiles(absRoot);
  const serverCandidates = detectServerCandidates(files);
  const clientCandidates = detectClientCandidates(files);
  const servers = validateServers(serverCandidates, absRoot);
  const bindings = linkClients(clientCandidates, servers, absRoot, files);
  return {
    servers,
    bindings,
    unresolved: { serverCandidates, clientCandidates },
  };
};
