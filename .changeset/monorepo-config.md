---
"hono-shaking": minor
---

feat: monorepo-friendly config discovery and naming

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
