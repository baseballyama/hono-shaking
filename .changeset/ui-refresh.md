---
"hono-shaking": minor
---

UI overhaul. The CLI now prints colored output, a compact summary
table, and per-phase `✓ done (time)` log lines as work progresses.
The spinner runs on a worker thread so it keeps animating during
heavy TypeScript Compiler API work. Hint text is added to phase
labels that can take a while ("may take a moment").

**Breaking**: the exit code is now `1` whenever any unused route is
found. The previous `--fail-on-unused` flag is removed (it's now the
default). Pass `--allow-unused` to keep CI green even with unused
routes (e.g. for inspection runs). `--fail-on-orphans` is unchanged.
