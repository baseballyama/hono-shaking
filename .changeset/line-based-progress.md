---
"hono-shaking": patch
---

Replace the worker-thread spinner with line-based progress
(`⏳ start` / `✓ done` lines). The spinner went invisible under
`pnpm dlx` and `npx` because those runners line-buffer the child
process's stderr; line-based progress lands on the screen immediately
in any output context. Each completed step now also reports how long
it took.
