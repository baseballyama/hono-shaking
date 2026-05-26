// User-facing configuration. Loaded from `hono-shaking.config.{ts,mts,mjs,js,cjs}`
// in the working directory (or `--config <path>`), and used to filter out
// known-good "unused" routes and orphan calls before reporting.
//
// .ts loading is delegated to jiti — the same loader Nuxt / Vitest use — so
// configs with transitive .ts imports work without extra build steps.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createJiti } from "jiti";

import type { CallSiteRef, DefinedRoute, HttpMethod } from "./types.ts";

export interface IgnoreRoutePattern {
  /** `null` matches any method (equivalent to `'*'`). */
  method: HttpMethod | HttpMethod[] | null;
  /** Glob pattern (`*` = one segment, `**` = any depth) or array of them. */
  path: string | string[];
  /**
   * Restrict to a specific server. Glob matched against the absolute path of
   * the AppType source file. Relative patterns (without a leading `/`) are
   * resolved against the directory of the config file, so a monorepo config
   * at the repo root can target `apps/api/src/index.ts` without needing
   * `**` prefixes. Use `null` to match across all servers.
   */
  serverAppTypeFile: string | null;
  /** Documentation only — not used by the matcher. */
  reason: string | null;
}

export interface IgnoreOrphanPattern {
  method: HttpMethod | HttpMethod[] | null;
  path: string | string[] | null;
  /**
   * Glob against the call site's file path. Relative patterns (without a
   * leading `/` or `*`) are resolved against the directory of the config
   * file. Examples:
   *   `apps/web/src/lib/foo.svelte`     — exact, relative to config dir
   *   `apps/web/**\/*.svelte`           — recursive, relative to config dir
   *   `**\/tiptap/Editor.svelte`        — match anywhere under config dir
   */
  file: string | null;
  reason: string | null;
}

export interface HonoShakingUserConfig {
  ignore: {
    routes: IgnoreRoutePattern[] | null;
    orphans: IgnoreOrphanPattern[] | null;
  } | null;
}

/** @deprecated Use {@link HonoShakingUserConfig}. Kept as an alias for pre-1.0 callers. */
export type HonoUnusedConfig = HonoShakingUserConfig;

/** Identity function used purely for type inference (Vite-style). */
export const defineConfig = (config: HonoShakingUserConfig): HonoShakingUserConfig => config;

const CONFIG_FILENAMES = [
  "hono-shaking.config.ts",
  "hono-shaking.config.mts",
  "hono-shaking.config.mjs",
  "hono-shaking.config.js",
  "hono-shaking.config.cjs",
] as const;

const findConfigInDir = (dir: string): string | null => {
  for (const name of CONFIG_FILENAMES) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
};

/**
 * Walk up from `start` to the filesystem root, returning the first directory
 * that contains a `hono-shaking.config.*`.
 */
const walkUpForConfig = (start: string): string | null => {
  let dir = resolve(start);
  while (true) {
    const hit = findConfigInDir(dir);
    if (hit != null) return hit;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

/**
 * Find the nearest `hono-shaking.config.*` by walking up from `cwd` (and from
 * `root` if it's a different filesystem subtree). Monorepo-friendly: running
 * the CLI from any sub-package finds a single config at the repo root.
 *
 * The legacy two-argument signature is preserved for backwards compatibility;
 * `root` is now treated as a secondary search start, not a flat fallback.
 */
export const findConfigFile = (cwd: string, root: string | null = null): string | null => {
  const fromCwd = walkUpForConfig(cwd);
  if (fromCwd != null) return fromCwd;
  if (root != null && resolve(root) !== resolve(cwd)) {
    return walkUpForConfig(root);
  }
  return null;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

const validateConfig = (raw: unknown, configPath: string): HonoShakingUserConfig => {
  // jiti sometimes returns the module record with a `default` field, sometimes
  // the value itself depending on how the file was written. Tolerate both.
  const value = isPlainObject(raw) && "default" in raw ? raw.default : raw;
  if (!isPlainObject(value)) {
    throw new Error(`config (${configPath}) must export an object as default`);
  }
  const out: HonoShakingUserConfig = { ignore: null };
  const ignoreRaw = value.ignore;
  if (ignoreRaw == null) return out;
  if (!isPlainObject(ignoreRaw)) {
    throw new Error(`config.ignore (${configPath}) must be an object`);
  }
  const routes = ignoreRaw.routes;
  const orphans = ignoreRaw.orphans;
  out.ignore = {
    routes: routes == null ? null : (routes as IgnoreRoutePattern[]),
    orphans: orphans == null ? null : (orphans as IgnoreOrphanPattern[]),
  };
  return out;
};

export const loadConfig = async (configPath: string): Promise<HonoShakingUserConfig> => {
  // jiti resolves imports relative to the config's own location, so transitive
  // `./shared.ts` imports work naturally.
  const jiti = createJiti(pathToFileURL(configPath).href, {
    interopDefault: true,
    moduleCache: false,
  });
  const raw = await jiti.import(configPath);
  return validateConfig(raw, configPath);
};

// ---- ignore matcher ----

/**
 * Convert a glob pattern into a regex: `**` matches any depth (including `/`),
 * `*` matches exactly one path segment (no `/`). All other regex
 * metacharacters are escaped.
 */
const globToRegex = (glob: string): RegExp => {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c == null) continue;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (".+?()[]{}|^$\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
};

const asArray = <T>(v: T | T[] | null): T[] => {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
};

const matchesMethod = (method: HttpMethod, pattern: IgnoreRoutePattern["method"]): boolean => {
  if (pattern == null) return true;
  const list = asArray(pattern);
  return list.length === 0 || list.includes(method);
};

const matchesAnyPath = (target: string, patterns: string[]): boolean =>
  patterns.length === 0 || patterns.some((p) => globToRegex(p).test(target));

/**
 * Resolve a glob written in the user's config against the config file's
 * directory. Patterns that begin with `/` (absolute) or `*` (already
 * recursive-from-anywhere) are left alone; everything else is treated as
 * relative to the config dir. This is what makes monorepo paths like
 * `apps/api/src/index.ts` work in a config at the repo root.
 */
const resolveConfigGlob = (glob: string, configDir: string): string => {
  if (glob.startsWith("/") || glob.startsWith("*")) return glob;
  return join(configDir, glob);
};

const matchesServer = (
  route: DefinedRoute,
  serverGlob: string | null,
  configDir: string,
): boolean => {
  if (serverGlob == null) return true;
  return globToRegex(resolveConfigGlob(serverGlob, configDir)).test(route.source);
};

const matchesFile = (target: string, fileGlob: string | null, configDir: string): boolean => {
  if (fileGlob == null) return true;
  return globToRegex(resolveConfigGlob(fileGlob, configDir)).test(target);
};

/**
 * A rule from the user's config that never matched anything during a run.
 * Usually this means the route was renamed / deleted, or the rule was a typo —
 * either way the rule is dead weight and the user probably wants to remove it.
 *
 * Note: rules are matched in array order with short-circuit `.some()`
 * semantics, so a rule is also reported as unmatched if an earlier rule
 * shadowed it (e.g. a broader catch-all listed first). That's intentional —
 * a fully-shadowed rule is also doing nothing.
 */
export interface UnmatchedConfigRule {
  kind: "route" | "orphan";
  /** Index of the rule in its original config array. */
  index: number;
  rule: IgnoreRoutePattern | IgnoreOrphanPattern;
}

export interface IgnoreFilter {
  isRouteIgnored: (route: DefinedRoute) => boolean;
  isOrphanIgnored: (call: CallSiteRef) => boolean;
  /**
   * Returns rules from the config that never matched anything routed through
   * this filter. Call after all routes / orphans have been processed (i.e. at
   * the end of the run); the result is a snapshot of the filter's hit counters
   * at that moment.
   */
  getUnmatchedRules: () => UnmatchedConfigRule[];
}

export const buildIgnoreFilter = (
  config: HonoShakingUserConfig,
  configDir: string,
): IgnoreFilter => {
  const routes = config.ignore?.routes ?? [];
  const orphans = config.ignore?.orphans ?? [];
  const routeHits: number[] = Array.from({ length: routes.length }, () => 0);
  const orphanHits: number[] = Array.from({ length: orphans.length }, () => 0);

  return {
    isRouteIgnored: (route) => {
      for (let i = 0; i < routes.length; i++) {
        const r = routes[i]!;
        if (
          matchesMethod(route.method, r.method) &&
          matchesAnyPath(route.path, asArray(r.path)) &&
          matchesServer(route, r.serverAppTypeFile, configDir)
        ) {
          routeHits[i]!++;
          return true;
        }
      }
      return false;
    },
    isOrphanIgnored: (call) => {
      for (let i = 0; i < orphans.length; i++) {
        const o = orphans[i]!;
        if (
          matchesMethod(call.method, o.method) &&
          (o.path == null || matchesAnyPath(call.path, asArray(o.path))) &&
          matchesFile(call.file, o.file, configDir)
        ) {
          orphanHits[i]!++;
          return true;
        }
      }
      return false;
    },
    getUnmatchedRules: () => {
      const out: UnmatchedConfigRule[] = [];
      for (let i = 0; i < routes.length; i++) {
        if (routeHits[i] === 0) out.push({ kind: "route", index: i, rule: routes[i]! });
      }
      for (let i = 0; i < orphans.length; i++) {
        if (orphanHits[i] === 0) out.push({ kind: "orphan", index: i, rule: orphans[i]! });
      }
      return out;
    },
  };
};
