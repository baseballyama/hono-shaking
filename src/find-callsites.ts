import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import ts from 'typescript';

import type { FrameworkAdapter } from './adapters/adapter.ts';
import { loadBuiltinAdapters } from './adapters/registry.ts';
import { loadProgram } from './ts-program.ts';
import type { CallSiteRef, HttpMethod } from './types.ts';

const METHOD_KEYS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

const toMethod = (key: string): HttpMethod | null => {
  if (!key.startsWith('$')) return null;
  const lower = key.slice(1);
  if (!METHOD_KEYS.has(lower)) return null;
  return lower.toUpperCase() as HttpMethod;
};

export interface FindOptions {
  tsconfigPath: string;
  /** Directory to scan. Files outside this directory are skipped. */
  includeDir: string;
  /** Substrings to skip (matched against absolute path). */
  exclude: string[] | null;
  /**
   * Extra hc client variable names. The TS pass auto-discovers names through
   * `const X = hc<...>(...)`; specify here only when a client is referenced
   * from a file that doesn't appear in the program (rare).
   */
  knownClientNames: string[] | null;
  /**
   * When provided, *only* these names are treated as hc client roots. Used by
   * the auto-discovery flow to scope a single scan to a known binding name.
   */
  restrictToClientNames: string[] | null;
  /**
   * Framework adapters to use for non-TypeScript files (.svelte, .vue, ...).
   * Pass `null` to auto-load every built-in adapter whose optional peer
   * dependency is installed.
   */
  adapters: FrameworkAdapter[] | null;
}

const segmentsToPath = (segments: string[]): string => `/${segments.join('/')}`;

/**
 * The receiver of `.$get(...)` (and other `$method` calls) is the *leaf* of
 * Hono's RPC proxy chain. Hono attaches `$url` only to those leaves; the
 * intermediate nodes such as `client.api.v1` do not have it. We use the
 * presence of `$url` as a precision gate to filter out incidental
 * `obj.$get(...)` patterns from non-Hono code.
 */
const receiverIsHcLeaf = (receiver: ts.Expression, checker: ts.TypeChecker): boolean => {
  const t = checker.getTypeAtLocation(receiver);
  return checker.getPropertiesOfType(t).some((p) => p.name === '$url');
};

interface RawChain {
  segments: string[];
  rootName: string | null;
}

/**
 * Walk a property / element access chain back to its root identifier, without
 * consulting the type checker. Returns the segments in source order and the
 * name of the identifier at the root, or `null` if the chain isn't statically
 * resolvable (e.g. computed access with a non-literal key).
 */
const walkChainRaw = (node: ts.Expression): RawChain | null => {
  const segments: string[] = [];
  let cursor: ts.Expression = node;
  while (true) {
    if (ts.isPropertyAccessExpression(cursor)) {
      segments.unshift(cursor.name.text);
      cursor = cursor.expression;
      continue;
    }
    if (ts.isElementAccessExpression(cursor)) {
      const arg = cursor.argumentExpression;
      if (!ts.isStringLiteralLike(arg)) return null;
      segments.unshift(arg.text);
      cursor = cursor.expression;
      continue;
    }
    if (ts.isIdentifier(cursor)) {
      return { segments, rootName: cursor.text };
    }
    return null;
  }
};

interface TruncateResult {
  matchedName: string;
  segments: string[];
}

/**
 * Given a raw chain `[rootName, ...segments]` and the set of known hc client
 * variable names, find the rightmost occurrence of a client name and return
 * the remaining segments after it. This handles indirect access like
 * `params.backendClient.api.v1.users.$get()` — `backendClient` is in the
 * middle of the chain rather than at the root.
 */
const truncateAtClient = (raw: RawChain, clientNames: Set<string>): TruncateResult | null => {
  const chain = [...(raw.rootName == null ? [] : [raw.rootName]), ...raw.segments];

  for (let i = chain.length - 1; i >= 0; i--) {
    const segment = chain[i];
    if (segment != null && clientNames.has(segment)) {
      return { matchedName: segment, segments: chain.slice(i + 1) };
    }
  }
  return null;
};

/**
 * Lightweight AST scan to find `const X = hc<...>(...)` patterns. The
 * variable name is collected as a known hc client root; we do *not* trust
 * the chain truncator to discover roots on its own because that would
 * conflate "I called .$get on a custom object" with "I called .$get on a
 * Hono client."
 */
const collectClientNamesFromProgram = (program: ts.Program): Set<string> => {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer != null) {
      const init = node.initializer;
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === 'hc' &&
        ts.isIdentifier(node.name)
      ) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    ts.forEachChild(sf, visit);
  }
  return names;
};

interface TsScanResult {
  calls: CallSiteRef[];
  clientNames: Set<string>;
}

interface TsScanOptions {
  tsconfigPath: string;
  absInclude: string;
  exclude: string[];
  extraClientNames: string[];
  restrictToClientNames: string[] | null;
}

const scanTsFiles = (opts: TsScanOptions): TsScanResult => {
  const { tsconfigPath, absInclude, exclude, extraClientNames, restrictToClientNames } = opts;
  const { program, checker } = loadProgram(tsconfigPath);
  const clientNames =
    restrictToClientNames == null
      ? new Set<string>([...collectClientNamesFromProgram(program), ...extraClientNames])
      : new Set<string>(restrictToClientNames);

  const calls: CallSiteRef[] = [];

  const visit = (sf: ts.SourceFile, node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = toMethod(callee.name.text);
        if (method != null) {
          const receiver = callee.expression;
          if (receiverIsHcLeaf(receiver, checker)) {
            const raw = walkChainRaw(receiver);
            if (raw != null) {
              const truncated = truncateAtClient(raw, clientNames);
              if (truncated != null && truncated.segments.length > 0) {
                const { line, character } = sf.getLineAndCharacterOfPosition(
                  callee.name.getStart(sf),
                );

                calls.push({
                  method,
                  path: segmentsToPath(truncated.segments),
                  file: sf.fileName,
                  line: line + 1,
                  column: character + 1,
                  matchedClientName: truncated.matchedName,
                });
              }
            }
          }
        }
      }
    }
    node.forEachChild((child) => visit(sf, child));
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const abs = resolve(sf.fileName);
    if (!abs.startsWith(absInclude)) continue;
    if (exclude.some((needle) => abs.includes(needle))) continue;
    visit(sf, sf);
  }

  return { calls, clientNames };
};

interface AdapterMatch {
  file: string;
  adapter: FrameworkAdapter;
}

const SKIP_WALK_DIRS = new Set(['node_modules', '.svelte-kit', 'dist', '.git']);

const listAdapterFiles = (
  dir: string,
  exclude: string[],
  adapters: FrameworkAdapter[],
): AdapterMatch[] => {
  const out: AdapterMatch[] = [];
  const walk = (cur: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch (err) {
      console.warn(`hono-shaking: skip ${cur}: ${String(err)}`);
      return;
    }
    for (const name of entries) {
      const p = join(cur, name);
      if (exclude.some((needle) => p.includes(needle))) continue;
      const stat = statSync(p);
      if (stat.isDirectory()) {
        if (SKIP_WALK_DIRS.has(name)) continue;
        walk(p);
      } else if (stat.isFile()) {
        const adapter = adapters.find((a) => a.matches(p));
        if (adapter != null) out.push({ file: p, adapter });
      }
    }
  };

  walk(dir);
  return out;
};

const scanWithAdapter = (
  file: string,
  adapter: FrameworkAdapter,
  clientNames: Set<string>,
): CallSiteRef[] => {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (err) {
    console.warn(`hono-shaking: skip ${file}: ${String(err)}`);
    return [];
  }

  const transformed = adapter.transform(file, content);
  if (transformed == null) return [];

  const sf = ts.createSourceFile(
    file,
    transformed.code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const calls: CallSiteRef[] = [];

  // Adapter scans have no type checker, so the leaf gate cannot apply. We
  // rely on the client-name whitelist to keep precision: only chains rooted
  // at a known hc variable are emitted.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = toMethod(callee.name.text);
        if (method != null) {
          const chain = walkChainRaw(callee.expression);
          if (chain != null) {
            const truncated = truncateAtClient(chain, clientNames);
            if (truncated != null && truncated.segments.length > 0) {
              const { line, character } = sf.getLineAndCharacterOfPosition(
                callee.name.getStart(sf),
              );

              // ts.SourceFile reports 0-based line / 0-based character. The
              // adapter contract expects 1-based line / 0-based column on
              // input and returns 1-based line / 1-based column.
              const orig = transformed.resolvePosition(line + 1, character);

              calls.push({
                method,
                path: segmentsToPath(truncated.segments),
                file,
                line: orig?.line ?? line + 1,
                column: orig?.column ?? character + 1,
                matchedClientName: truncated.matchedName,
              });
            }
          }
        }
      }
    }
    node.forEachChild(visit);
  };

  visit(sf);
  return calls;
};

/**
 * Walk every source file in `includeDir` for hc call sites. Yields
 * `CallSiteRef`s annotated with the matched client name so a downstream diff
 * can group them by binding.
 */
export const findCallsites = async (options: FindOptions): Promise<CallSiteRef[]> => {
  const { tsconfigPath, includeDir } = options;
  const exclude = options.exclude ?? [];
  const knownClientNames = options.knownClientNames ?? [];
  const restrictToClientNames = options.restrictToClientNames;
  const adapters = options.adapters ?? (await loadBuiltinAdapters());
  const absInclude = resolve(includeDir) + sep;

  const tsResult = scanTsFiles({
    tsconfigPath,
    absInclude,
    exclude,
    extraClientNames: knownClientNames,
    restrictToClientNames,
  });

  const adapterCalls: CallSiteRef[] = [];
  if (adapters.length > 0 && tsResult.clientNames.size > 0) {
    const adapterFiles = listAdapterFiles(absInclude, exclude, adapters);
    for (const { file, adapter } of adapterFiles) {
      adapterCalls.push(...scanWithAdapter(file, adapter, tsResult.clientNames));
    }
  }

  const all = [...tsResult.calls, ...adapterCalls];
  all.sort((a, b) => {
    const byFile = a.file.localeCompare(b.file);
    if (byFile === 0) {
      return a.line === b.line ? a.column - b.column : a.line - b.line;
    }
    return byFile;
  });
  return all;
};

/** Names of adapters that successfully loaded (diagnostics helper). */
export const listAdapters = async (): Promise<string[]> => {
  const adapters = await loadBuiltinAdapters();
  return adapters.map((a) => a.name);
};
