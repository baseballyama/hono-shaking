export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD" | "ALL";

export interface RouteRef {
  method: HttpMethod;
  path: string;
}

export interface DefinedRoute extends RouteRef {
  /** Absolute path of the file that re-exports the AppType. Used in reports only. */
  source: string;
}

export interface CallSiteRef extends RouteRef {
  file: string;
  /** 1-based line number in the original source (after sourcemap remap for .svelte / .vue). */
  line: number;
  /** 1-based column number in the original source. */
  column: number;
  /**
   * Name of the hc client variable the chain was rooted at (e.g. `backendClient`).
   * `null` only happens for adapter-scanned files where the root wasn't an
   * identifier — currently unused but reserved for diagnostics.
   */
  matchedClientName: string | null;
}

export interface DiffResult {
  /** Defined on the server but not called by any scanned client. */
  unused: DefinedRoute[];
  /**
   * Called by a client but no matching server definition. Usually means
   * the call drifted from the schema (typo, removed route) or the client
   * is talking to a server not included in the analysis.
   */
  orphanCalls: CallSiteRef[];
  /** Used routes, each annotated with the call sites that hit them. */
  used: { route: DefinedRoute; callSites: CallSiteRef[] }[];
}
