---
"hono-shaking": patch
---

Fix Svelte / Vue adapter detection under `pnpm dlx` / `npx`. The
framework integrations (`svelte2tsx`, `@vue/compiler-sfc`) are now
declared as `optionalDependencies` instead of optional peer
dependencies, so they install alongside hono-shaking automatically.
Previously, in pnpm's isolated install mode they only appeared in
`.pnpm/` and weren't reachable from the dlx temp directory.
