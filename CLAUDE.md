# CLAUDE.md

## Project overview

**`hono-shaking`** is a static-analysis CLI / library that finds unused
[Hono RPC](https://hono.dev/docs/guides/rpc) endpoints in a TypeScript codebase.
It reads the server's `AppType` via the TypeScript Compiler API to enumerate
defined routes, walks client source for `hc<T>(...)` call sites, and reports
the diff. It also auto-discovers server/client pairs across a monorepo.

### Tech stack

| Layer       | Choice                                                        |
| ----------- | ------------------------------------------------------------- |
| Language    | TypeScript (strict)                                           |
| Runtime     | Node.js >= 20                                                 |
| Bundler     | tsup (zero-config, builds ESM + d.ts)                         |
| Tests       | Vitest                                                        |
| Lint+format | Biome                                                         |
| Versioning  | Changesets (npm publish via OIDC Trusted Publishers)          |
| Type info   | `typescript` package's Compiler API (does not depend on tsgo) |
| Config load | `jiti` (handles `.ts` config files with transitive imports)   |

### Frameworks (optional peer deps)

- `.svelte` files: requires `svelte2tsx` (+ `svelte`). Transitively resolved via
  `@jridgewell/trace-mapping` for accurate source positions.
- `.vue` files: requires `@vue/compiler-sfc`.

Adapters are auto-loaded; missing peer deps simply disable that framework.

## Operating context

- **Audience**: OSS — code that external contributors and end users read.
- **Comments**: English. Explain WHY, not WHAT.
- **Public API**: anything exported from `src/index.ts` is a contract.

## Core principles

| Principle           | What it means here                                                       |
| ------------------- | ------------------------------------------------------------------------ |
| Simplicity          | One way to do one thing. No parallel APIs.                               |
| Type-driven         | Lean on the TS Compiler API rather than re-implementing route parsing.   |
| Precision over coverage | False positives are worse than false negatives. Errors of omission can be added back via config; false unused reports erode trust. |
| Maintainable        | Code that a first-time contributor can follow without prior context.     |
| Backwards-compat    | SemVer. Public API additions are minor; behavior changes are major.      |

## "One way to do one thing"

A capability has exactly one canonical path through the public API. Do not add
a parallel path "for convenience." Specifically for this project:

- There is **one** discovery flow: `--root <dir>` triggers `discoverProject`.
- There is **one** explicit-config flow: `--server-tsconfig` + friends.
- Framework support is via **`FrameworkAdapter`**, not ad-hoc parsers.
- Ignores are expressed in **one** config schema (`HonoUnusedConfig`).

## Hard "no"s

- **Swallow exceptions silently** — fail loud, especially when loading user config.
- **`as unknown as T`** — use proper type narrowing.
- **Magic globs** — patterns live in config, not buried in code.
- **Drift between AST walker and type checker** — leaf detection uses the type
  checker (`$url` on `ClientRequest`). The walker is type-free for `.svelte` /
  `.vue` and relies on the discovered client-name whitelist.

## Architecture

```
src/
├── index.ts           Public library exports (defineConfig, discoverProject, …)
├── cli.ts             CLI entry point (parses args, runs auto or manual flow)
├── types.ts           Cross-module shared types (HttpMethod, DefinedRoute, …)
├── ts-program.ts      tsconfig → ts.Program loader
├── extract-routes.ts  AppType → DefinedRoute[] via type checker
├── find-callsites.ts  Walk client source for hc<>() chains, emit CallSiteRef[]
├── diff.ts            Compute unused/used/orphan from defined vs called
├── discover.ts        Walk a repo to auto-discover server/client pairs
├── config.ts          Load hono-shaking.config.{ts,js,…} + apply ignores
└── adapters/
    ├── adapter.ts     FrameworkAdapter interface + position remapping types
    ├── registry.ts    Async loader that tries svelte/vue and skips missing deps
    ├── svelte.ts      svelte2tsx adapter with sourcemap-based position trace
    └── vue.ts         @vue/compiler-sfc adapter with line-offset position map
```

### Detection invariant

The chain walker is the central correctness boundary. The receiver of
`.$get(...)` etc. must have `$url` on its type (the Hono RPC leaf marker);
otherwise the call is rejected as a false positive. After that gate, chain
segments are collected purely structurally and **truncated at the rightmost
known hc client name** so that `params.backendClient.api.v1.users.$get()`
correctly yields `/api/v1/users`.

When you change the walker, **do not weaken the leaf check** — it is what keeps
us from flagging coincidental `obj.$get(...)` patterns.

## Tests

- `tests/fixtures/<scenario>/` — self-contained fixture projects (server +
  client + tsconfig). Each scenario covers one behavior (direct binding,
  factory, svelte, vue, ignore config, …).
- `tests/*.test.ts` — Vitest specs that invoke the library API or the CLI
  against the fixtures.

Add a new fixture when you add a feature, and ensure the fixture would **fail**
without the change (no coverage-prop tests).

## OSS-specific discipline

### Public API is a contract

Anything exported from `src/index.ts` is documented (or will be) in the README.
Users depend on the shape, name, behavior, and exceptions.

| Change             | SemVer        |
| ------------------ | ------------- |
| Add new export     | minor         |
| Change behavior    | major         |
| Remove / rename    | major (+ deprecate first post-1.0) |
| Add CLI flag       | minor         |
| Change CLI default | major (it changes scripts in user repos) |

### Changesets are user-facing

Write changesets from the user's perspective:

- ✅ `feat: add --per-binding flag for per-client breakdown`
- ✅ `fix: chain truncation no longer drops calls rooted at this.client`
- ❌ `refactor: extract resolveAppTypeServer helper`

Pure-internal refactors don't need a changeset.

## Skills

The `.claude/skills/` directory contains workflow guides inherited from the
[`my-oss-starter`](https://github.com/baseballyama/my-oss-starter) template.

| Skill                | When to use                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `pr-workflow`        | Creating a PR                                                     |
| `full-code-review`   | Reviewing a branch before opening a PR                            |
| `review-response`    | Responding to GitHub review comments                              |
| `run-check-and-test` | Running quality checks and tests before commit / PR               |
| `issue-triage`       | Classifying a GitHub issue and routing it to the right workflow   |
