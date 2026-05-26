# hono-shaking

## 0.4.0

### Minor Changes

- ada180b: feat: warn on dead config entries; add `--fail-on-dead-config`

  Ignore rules in `hono-shaking.config.ts` (`ignore.routes[]`,
  `ignore.orphans[]`) that never match anything during a run are now
  reported as warnings on stderr by default, so stale entries don't quietly
  outlive the routes they were written for. A rule is also reported as
  unmatched when an earlier broader rule fully shadows it — both forms are
  effectively dead config the user probably wants to clean up.

  Two new CLI flags:

  - `--fail-on-dead-config` — exit `1` if any ignore rule was unmatched.
    Useful in CI to keep the config from rotting as routes are renamed
    or removed.
  - `--no-warn-dead-config` — silence the warning (default is to print).

  The library API gains `IgnoreFilter.getUnmatchedRules()` and an
  `UnmatchedConfigRule` type for callers that want to render their own
  report.

- 0c1f311: feat: monorepo-friendly config discovery and naming

  `hono-shaking.config.{ts,mts,mjs,js,cjs}` is now discovered by walking up
  the filesystem from the directory you run the CLI in. A single config at
  the repo root applies whether you run from the root, from `apps/api`, or
  from any other sub-package — no need to pass `--config` or `--root`
  explicitly.

  Path-shaped fields in the config (`serverAppTypeFile` on route ignores,
  `file` on orphan ignores) without a leading `/` or `*` are now resolved
  relative to the config file's directory. This was already the case for
  `serverAppTypeFile`; the `file` glob is now consistent with it. Globs
  that already started with `**/` or `/` keep their previous meaning.

  The exported config type has been renamed to `HonoShakingUserConfig` to
  match the Vite-style convention (`ViteUserConfig`). The old name
  `HonoUnusedConfig` is kept as a deprecated alias for backwards
  compatibility.

## 0.3.3

### Patch Changes

- 250eaed: Rework the progress output so each step occupies a single, in-place
  updated row. The previous version printed a new `… working Xs` line
  every two seconds, which piled up dozens of lines on long phases and
  made the output hard to read.

  The heartbeat now uses `\x1b[1A\x1b[2K` (cursor up + erase line) and
  ends each frame with a newline, so the previous row is overwritten in
  place even when stderr is wrapped by a line-buffered runner such as
  `pnpm dlx`. A step's row transitions:

  ```
  ⏳ Discovering server / client pairs…
  ⠼ Discovering server / client pairs… (7.3s)
  ✓ Discovered 5 servers / 10 bindings (17.7s)
  ```

  If `CI`, `NO_COLOR`, or `TERM=dumb` are set, the heartbeat is
  suppressed entirely and only the ⏳ start / ✓ end lines are emitted —
  ANSI cursor escapes would otherwise leak into log files as literal
  bytes.

## 0.3.2

### Patch Changes

- 1daae98: Print an elapsed-time heartbeat every 2 seconds while long phases are
  running so the tool no longer looks frozen during the 5–20 second
  `discoverProject` and per-server / per-client scans in large
  monorepos.

## 0.3.1

### Patch Changes

- 1a103f3: Replace the worker-thread spinner with line-based progress
  (`⏳ start` / `✓ done` lines). The spinner went invisible under
  `pnpm dlx` and `npx` because those runners line-buffer the child
  process's stderr; line-based progress lands on the screen immediately
  in any output context. Each completed step now also reports how long
  it took.

## 0.3.0

### Minor Changes

- 52dbf35: UI overhaul. The CLI now prints colored output, a compact summary
  table, and per-phase `✓ done (time)` log lines as work progresses.
  The spinner runs on a worker thread so it keeps animating during
  heavy TypeScript Compiler API work. Hint text is added to phase
  labels that can take a while ("may take a moment").

  **Breaking**: the exit code is now `1` whenever any unused route is
  found. The previous `--fail-on-unused` flag is removed (it's now the
  default). Pass `--allow-unused` to keep CI green even with unused
  routes (e.g. for inspection runs). `--fail-on-orphans` is unchanged.

## 0.2.0

### Minor Changes

- 5db1076: Show a stderr progress spinner during the slow phases of `--root` mode
  (discovery, per-server route extraction, per-client scan). Suppressed
  under `--json` and on non-TTY stderr; in the non-TTY fallback the same
  phase labels are emitted as one-shot `# ...` lines so logs remain
  self-documenting.

## 0.1.4

### Patch Changes

- 4db2da4: Fix Svelte / Vue adapter detection under `pnpm dlx` / `npx`. The
  framework integrations (`svelte2tsx`, `@vue/compiler-sfc`) are now
  declared as `optionalDependencies` instead of optional peer
  dependencies, so they install alongside hono-shaking automatically.
  Previously, in pnpm's isolated install mode they only appeared in
  `.pnpm/` and weren't reachable from the dlx temp directory.

## 0.1.3

### Patch Changes

- 078e1f6: Fix Svelte / Vue adapters when running via `pnpm dlx` or `npx`. The
  adapter loaders now resolve `svelte2tsx` and `@vue/compiler-sfc` from
  the user's working directory, so they pick up the optional peer deps
  installed in the project being scanned even when hono-shaking itself
  lives in a temporary directory.

## 0.1.2

### Patch Changes

- f628033: Internal toolchain swap: lint moved from biome to oxlint, format moved
  from biome to oxfmt. No user-facing behaviour change; published
  artefacts are identical except for source quote style.

## 0.1.1

### Patch Changes

- a0b00a1: Replace `tsup` with `tsdown` as the bundler. Published `dist/` now uses
  `.mjs` / `.d.mts` extensions; the public import surface and the
  `hono-shaking` bin entry are unchanged.
