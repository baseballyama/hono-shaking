// User-facing configuration. Loaded from `hono-shaking.config.{ts,mts,mjs,js,cjs}`
// in the working directory (or `--config <path>`), and used to filter out
// known-good "unused" routes and orphan calls before reporting.
//
// .ts loading is delegated to jiti — the same loader Nuxt / Vitest use — so
// configs with transitive .ts imports work without extra build steps.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createJiti } from 'jiti';

import type { CallSiteRef, DefinedRoute, HttpMethod } from './types.ts';

export interface IgnoreRoutePattern {
  /** `null` matches any method (equivalent to `'*'`). */
  method: HttpMethod | HttpMethod[] | null;
  /** Glob pattern (`*` = one segment, `**` = any depth) or array of them. */
  path: string | string[];
  /**
   * Restrict to a specific server. Glob matched against the absolute path of
   * the AppType source file. Use `null` to match across all servers.
   */
  serverAppTypeFile: string | null;
  /** Documentation only — not used by the matcher. */
  reason: string | null;
}

export interface IgnoreOrphanPattern {
  method: HttpMethod | HttpMethod[] | null;
  path: string | string[] | null;
  /** Glob against the call site's file path (e.g. `**\/tiptap/Editor.svelte`). */
  file: string | null;
  reason: string | null;
}

export interface HonoUnusedConfig {
  ignore: {
    routes: IgnoreRoutePattern[] | null;
    orphans: IgnoreOrphanPattern[] | null;
  } | null;
}

/** Identity function used purely for type inference (Vite-style). */
export const defineConfig = (config: HonoUnusedConfig): HonoUnusedConfig => config;

const CONFIG_FILENAMES = [
  'hono-shaking.config.ts',
  'hono-shaking.config.mts',
  'hono-shaking.config.mjs',
  'hono-shaking.config.js',
  'hono-shaking.config.cjs',
] as const;

/** Look in `cwd`, then optionally `root`, for any of the supported config filenames. */
export const findConfigFile = (cwd: string, root: string | null): string | null => {
  const dirs = [cwd];
  if (root != null && resolve(root) !== resolve(cwd)) dirs.push(resolve(root));
  for (const dir of dirs) {
    for (const name of CONFIG_FILENAMES) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

const validateConfig = (raw: unknown, configPath: string): HonoUnusedConfig => {
  // jiti sometimes returns the module record with a `default` field, sometimes
  // the value itself depending on how the file was written. Tolerate both.
  const value = isPlainObject(raw) && 'default' in raw ? raw.default : raw;
  if (!isPlainObject(value)) {
    throw new Error(`config (${configPath}) must export an object as default`);
  }
  const out: HonoUnusedConfig = { ignore: null };
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

export const loadConfig = async (configPath: string): Promise<HonoUnusedConfig> => {
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
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c == null) continue;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if ('.+?()[]{}|^$\\'.includes(c)) {
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

const matchesMethod = (method: HttpMethod, pattern: IgnoreRoutePattern['method']): boolean => {
  if (pattern == null) return true;
  const list = asArray(pattern);
  return list.length === 0 || list.includes(method);
};

const matchesAnyPath = (target: string, patterns: string[]): boolean =>
  patterns.length === 0 || patterns.some((p) => globToRegex(p).test(target));

const matchesServer = (
  route: DefinedRoute,
  serverGlob: string | null,
  configDir: string,
): boolean => {
  if (serverGlob == null) return true;
  const resolvedGlob = serverGlob.startsWith('/') ? serverGlob : join(configDir, serverGlob);
  return globToRegex(resolvedGlob).test(route.source);
};

const matchesFile = (target: string, fileGlob: string | null): boolean => {
  if (fileGlob == null) return true;
  return globToRegex(fileGlob).test(target);
};

export interface IgnoreFilter {
  isRouteIgnored: (route: DefinedRoute) => boolean;
  isOrphanIgnored: (call: CallSiteRef) => boolean;
}

export const buildIgnoreFilter = (config: HonoUnusedConfig, configDir: string): IgnoreFilter => {
  const routes = config.ignore?.routes ?? [];
  const orphans = config.ignore?.orphans ?? [];

  return {
    isRouteIgnored: (route) =>
      routes.some(
        (r) =>
          matchesMethod(route.method, r.method) &&
          matchesAnyPath(route.path, asArray(r.path)) &&
          matchesServer(route, r.serverAppTypeFile, configDir),
      ),
    isOrphanIgnored: (call) =>
      orphans.some(
        (o) =>
          matchesMethod(call.method, o.method) &&
          (o.path == null || matchesAnyPath(call.path, asArray(o.path))) &&
          matchesFile(call.file, o.file),
      ),
  };
};
