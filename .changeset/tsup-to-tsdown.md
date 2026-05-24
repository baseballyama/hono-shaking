---
'hono-shaking': patch
---

Replace `tsup` with `tsdown` as the bundler. Published `dist/` now uses
`.mjs` / `.d.mts` extensions; the public import surface and the
`hono-shaking` bin entry are unchanged.
