# hono-shaking

> Find unused [Hono RPC](https://hono.dev/docs/guides/rpc) endpoints.
> Type-driven, monorepo-aware, Svelte / Vue / tsgo friendly.

`hono-shaking` is a static analyzer for projects that use Hono's
[RPC client](https://hono.dev/docs/guides/rpc) (`hc<AppType>()`). It reads
the server's exported `AppType` via the TypeScript Compiler API, walks the
client source for `hc<>()` call sites, and reports the routes the server
defines that nobody actually calls.

```
$ npx hono-shaking

# Discovered servers
  apps/api/src/index.ts :: AppType (124 routes)

# Discovered bindings
  apps/web/src/lib/client.ts :: backendClient  →  apps/api/src/index.ts :: AppType

== apps/api :: AppType ==
  consumers: apps/web::backendClient(118)
  defined routes : 124
  used routes    : 118
  unused routes  : 6
  orphan calls   : 0

  Unused routes (6)
    POST    /api/v1/integrations/zendesk/webhook
    GET     /api/v1/integrations/salesforce/oauth/callback
    GET     /api/v1/dashboards
    ...
```

## Why

Hono RPC ties every client call to a server route through the type system.
Once you have that wire — `hc<AppType>` — you also have everything you need
to ask the opposite question: **which server routes does nobody on the
client ever call?**

Existing dead-code tools (`knip`, `ts-prune`, …) reason at the export level.
They can't say "this route handler is unused" because the route is reachable
via its registration in `app.get(...)`. `hono-shaking` operates at the
route-schema level instead, which is the unit of dead code that actually
matters for an HTTP API.

Use cases:

- **PR gate**: fail CI if a PR adds a new endpoint with no client call.
- **Refactor planning**: find handlers safe to delete after a frontend
  rewrite.
- **Schema drift detection**: orphan call sites surface typos and removed
  routes that the type checker missed (e.g. inside `.svelte` / `.vue`).

## When NOT to use this

- Your API isn't called via `hc<AppType>(...)` (REST clients, fetch wrappers,
  generated SDKs). The analyzer keys on the hc proxy; outside that shape
  every route looks unused.
- Your endpoints are called only by external systems (webhook receivers,
  OAuth callbacks, public APIs). They'll show up as "unused" — list them
  under `ignore.routes` to suppress.
- You're looking for unused functions / files in general. Use
  [`knip`](https://github.com/webpro-nl/knip) for that.

## Install

```bash
pnpm add -D hono-shaking          # or npm / yarn
```

Framework support is via optional peer dependencies; install only the ones
your project uses.

```bash
# For .svelte files
pnpm add -D svelte2tsx svelte

# For .vue files
pnpm add -D @vue/compiler-sfc
```

Without these, hono-shaking still works on `.ts` / `.tsx` files; framework
files are just skipped.

### tsgo

`hono-shaking` uses the standard [`typescript`](https://www.npmjs.com/package/typescript)
package's Compiler API to read your `AppType`. It never invokes `tsc` as a
binary. Projects that have switched their build / type-check to
[tsgo](https://github.com/microsoft/typescript-go) are unaffected — the
bundled `typescript` runs alongside, reading the same `tsconfig.json`.

## Usage

### Auto-detect (recommended)

Run with no arguments from the repository root:

```bash
npx hono-shaking
```

This is equivalent to `--root .`. Pass `--root <dir>` to point at a
different location.

It walks the tree, finds every `export type X = typeof Y` that looks like a
Hono app, finds every `hc<T>(...)` call, and resolves each `T` through the
TypeScript checker to pair them up. Monorepos with multiple servers and
multiple frontends are supported out of the box.

Auto-detect handles two binding patterns:

| Pattern | Example                                                      |
| ------- | ------------------------------------------------------------ |
| Direct  | `const client = hc<AppType>(url)`                            |
| Factory | `const make = () => hc<AppType>(url); const client = make()` |

The factory pattern is common when you wrap `hc()` in a function to inject
headers / fetch options — auto-detect follows the function definition and
finds the consumers.

### Manual

If you only want to analyze one server / client pair, pass them explicitly:

```bash
npx hono-shaking \
  --server-tsconfig apps/api/tsconfig.json \
  --app-type-file   apps/api/src/index.ts \
  --client-tsconfig apps/web/tsconfig.json \
  --client-dir      apps/web/src
```

### CI

```bash
# Fail the build if a PR introduces an unused route (or call sites with no matching server route).
npx hono-shaking --fail-on-unused --fail-on-orphans
```

The exit code reflects findings _after_ the config-driven ignore list is
applied. Adding a route to `ignore.routes` is how a team explicitly accepts
a non-hc endpoint without breaking the build.

### JSON output

```bash
npx hono-shaking --json > report.json
```

Diagnostic messages (`# adapters loaded: ...`, `# config: ...`) go to stderr
so JSON on stdout stays clean for pipelines.

## Configuration

Drop a `hono-shaking.config.ts` (or `.mts` / `.mjs` / `.js` / `.cjs`) in the
working directory. It's loaded by [`jiti`](https://github.com/unjs/jiti) —
the same TS loader Nuxt and Vitest use — so transitive `.ts` imports work
without a build step.

```ts
// hono-shaking.config.ts
import { defineConfig } from "hono-shaking";

export default defineConfig({
  ignore: {
    routes: [
      // SSE / streaming endpoints — called via raw fetch, not hc.
      { method: null, path: "/api/sse/**", reason: "SSE — raw fetch" },

      // OAuth callbacks — invoked by the IdP, not the frontend.
      { method: "GET", path: "/api/oauth/**", reason: "IdP callback" },

      // Webhooks called by external systems.
      { method: "POST", path: "/api/webhooks/zendesk" },
    ],
    orphans: [
      // A call to a different backend that legitimately doesn't appear
      // in the AppType we're analyzing.
      { method: "GET", path: "/token", file: "**/tiptap/Editor.svelte" },
    ],
  },
});
```

### Schema

```ts
interface HonoUnusedConfig {
  ignore: {
    routes: IgnoreRoutePattern[] | null;
    orphans: IgnoreOrphanPattern[] | null;
  } | null;
}

interface IgnoreRoutePattern {
  /** `null` matches any method. */
  method: HttpMethod | HttpMethod[] | null;
  /** Glob (`*` = one segment, `**` = any depth) or array. */
  path: string | string[];
  /** Restrict to a specific server's AppType file (glob, optional). */
  serverAppTypeFile: string | null;
  /** Documentation only. */
  reason: string | null;
}

interface IgnoreOrphanPattern {
  method: HttpMethod | HttpMethod[] | null;
  path: string | string[] | null;
  /** Glob against the call site's file path. */
  file: string | null;
  reason: string | null;
}
```

### CLI overrides

| Flag              | Purpose                     |
| ----------------- | --------------------------- |
| `--config <path>` | Explicit config file path.  |
| `--no-config`     | Skip config auto-discovery. |

## How it works

1. **Extract** routes from the server. We resolve the `AppType` symbol via
   the Compiler API and walk Hono's schema type parameter
   `{ [path]: { $get: Endpoint, $post: Endpoint, ... } }`. Chained
   `.route(...)` calls accumulate the schema as a union; we flatten the
   union and merge all members' keys.

2. **Detect** call sites in the client. For every `obj.$get(...)` (or
   `$post`, etc.) we ask the type checker whether the receiver has Hono's
   `$url` property — that's a unique marker on the RPC proxy's _leaf_
   nodes, and it's the central precision gate that keeps us from matching
   `obj.$get(...)` on unrelated objects.

3. **Truncate** the chain at the rightmost known hc client name. This is
   what handles `params.backendClient.api.v1.users.$get()` — the client
   variable lives in the middle of the chain, not at the root.

4. **Diff** defined vs called by `(method, path)` to produce
   `unused` / `used` / `orphan`.

5. **Discover** (for `--root` mode) walks the repo for server and client
   candidates, runs the type checker to validate each candidate and to
   resolve `hc<T>` to its declaring file, and groups bindings by server so
   "unused" is calculated across _all_ consumers of a server, not per
   consumer.

For `.svelte` and `.vue`, each file is run through a `FrameworkAdapter`
(`svelte2tsx` or `@vue/compiler-sfc`) that emits a virtual TS source plus a
sourcemap-style position remapping. Adapter scans don't have a type
checker, so they rely on the whitelist of hc client names discovered by the
TS pass.

## Library API

The CLI is a thin shell over a library API. Use it directly when you need
something the CLI doesn't expose (custom output, custom ignores derived
from runtime data, etc.).

```ts
import {
  discoverProject,
  extractRoutes,
  findCallsites,
  diffRoutes,
  buildIgnoreFilter,
  loadConfig,
} from "hono-shaking";

const { servers, bindings } = discoverProject(".");

for (const binding of bindings) {
  const defined = extractRoutes({
    tsconfigPath: binding.server.tsconfigPath,
    appTypeFile: binding.server.appTypeFile,
    exportName: binding.server.exportName,
  });

  const called = await findCallsites({
    tsconfigPath: binding.clientTsconfigPath,
    includeDir: binding.clientPackageDir,
    exclude: null,
    knownClientNames: null,
    restrictToClientNames: [binding.variableName],
    adapters: null, // auto-load svelte / vue if installed
  });

  const diff = diffRoutes(defined, called);
  // diff.unused, diff.used, diff.orphanCalls
}
```

## Known limitations

- **Computed access**: `client[someVar].$get()` with a non-literal key is
  skipped. Literal keys (`client['users'].$get()`) work fine.
- **Cross-repo clients**: a `.ts` file outside the analyzed program isn't
  visible. Run hono-shaking in the repo where both server and client live,
  or run it twice (once per repo) and union the results.

### Imports we _do_ handle

`hc` resolution goes through the TypeScript symbol resolver, so any shape
the compiler can follow works — including aliases, namespace imports, and
re-exports through your own barrels:

```ts
import { hc } from "hono/client";
import { hc as createClient } from "hono/client";
import * as hono from "hono/client";
//        ^ then called as hono.hc<T>(...)

// Re-export through your own barrel:
//   @org/backend/client.ts:  export { hc } from 'hono/client';
import { hc } from "@org/backend/client";
import { hc as createClient } from "@org/backend/client";
```

## License

[MIT](./LICENSE)
