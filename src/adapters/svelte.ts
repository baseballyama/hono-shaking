import { type SourceMapInput, TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

import type { FrameworkAdapter, TransformedScript } from './adapter.ts';

type Svelte2tsxFn = (source: string, options: object) => { code: string; map: object };

/**
 * Pull a named function out of an ESM/CJS-interop module record. We try the
 * top-level export first, then the `default` export (which on a CJS module
 * loaded from ESM holds the original exports object), then `default` itself
 * if it's a function.
 */
const pickFunction = (mod: unknown, key: string): unknown => {
  if (mod == null || typeof mod !== 'object') return null;
  const top = (mod as Record<string, unknown>)[key];
  if (typeof top === 'function') return top;
  const def = (mod as Record<string, unknown>).default;
  if (def != null && typeof def === 'object') {
    const nested = (def as Record<string, unknown>)[key];
    if (typeof nested === 'function') return nested;
  }
  if (typeof def === 'function') return def;
  return null;
};

/**
 * Build a Svelte adapter if `svelte2tsx` is installed. Returns `null` when
 * the optional peer dep is missing, which lets the registry skip the adapter
 * silently instead of crashing on import.
 */
export const createSvelteAdapter = async (): Promise<FrameworkAdapter | null> => {
  let svelte2tsx: Svelte2tsxFn;
  try {
    const mod = await import('svelte2tsx');
    const fn = pickFunction(mod, 'svelte2tsx');
    if (typeof fn !== 'function') return null;
    svelte2tsx = fn as Svelte2tsxFn;
  } catch (err) {
    if (process.env.HONO_SHAKING_DEBUG != null) {
      console.warn(`svelte adapter unavailable: ${String(err)}`);
    }
    return null;
  }

  return {
    name: 'svelte',
    extensions: ['svelte'],
    matches: (file) => file.endsWith('.svelte'),
    transform: (file, content): TransformedScript | null => {
      let result: { code: string; map: object };
      try {
        result = svelte2tsx(content, { filename: file, isTsFile: true });
      } catch (err) {
        // Per-file parse error (e.g. invalid Svelte syntax) — skip this file
        // but keep the rest of the scan running.
        console.warn(`hono-shaking: svelte parse failed for ${file}: ${String(err)}`);
        return null;
      }

      const tracer = new TraceMap(result.map as SourceMapInput);
      return {
        code: result.code,
        // svelte2tsx emits source maps in 1-based line / 0-based column. We
        // re-add 1 to the original column so callers get 1-based throughout.
        resolvePosition: (line, column) => {
          const orig = originalPositionFor(tracer, { line, column });
          if (orig.line == null || orig.column == null) return null;
          return { line: orig.line, column: orig.column + 1 };
        },
      };
    },
  };
};
