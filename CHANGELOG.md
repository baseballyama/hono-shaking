# hono-shaking

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
