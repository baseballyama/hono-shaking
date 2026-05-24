# hono-shaking

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
