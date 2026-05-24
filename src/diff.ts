import type { CallSiteRef, DefinedRoute, DiffResult, RouteRef } from "./types.ts";

const key = (r: RouteRef): string => `${r.method} ${r.path}`;

/**
 * Compare server-side defined routes against client-side call sites.
 *
 * - A route with no matching call site → `unused`.
 * - A call site with no matching defined route → `orphan` (typo / drift, or
 *   the call targets a server not included in the analysis).
 * - Otherwise the route is `used`, annotated with the call sites that hit it.
 */
export const diffRoutes = (defined: DefinedRoute[], called: CallSiteRef[]): DiffResult => {
  const callsByKey = new Map<string, CallSiteRef[]>();
  for (const c of called) {
    const k = key(c);
    const list = callsByKey.get(k);
    if (list == null) callsByKey.set(k, [c]);
    else list.push(c);
  }

  const definedKeys = new Set(defined.map((r) => key(r)));
  const unused: DefinedRoute[] = [];
  const used: DiffResult["used"] = [];
  for (const r of defined) {
    const sites = callsByKey.get(key(r)) ?? [];
    if (sites.length === 0) unused.push(r);
    else used.push({ route: r, callSites: sites });
  }

  const orphanCalls: CallSiteRef[] = [];
  for (const c of called) {
    if (!definedKeys.has(key(c))) orphanCalls.push(c);
  }

  return { unused, used, orphanCalls };
};
