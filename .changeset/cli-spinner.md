---
"hono-shaking": minor
---

Show a stderr progress spinner during the slow phases of `--root` mode
(discovery, per-server route extraction, per-client scan). Suppressed
under `--json` and on non-TTY stderr; in the non-TTY fallback the same
phase labels are emitted as one-shot `# ...` lines so logs remain
self-documenting.
