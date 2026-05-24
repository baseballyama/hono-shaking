---
"hono-shaking": patch
---

Fix Svelte / Vue adapters when running via `pnpm dlx` or `npx`. The
adapter loaders now resolve `svelte2tsx` and `@vue/compiler-sfc` from
the user's working directory, so they pick up the optional peer deps
installed in the project being scanned even when hono-shaking itself
lives in a temporary directory.
