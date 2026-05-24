---
"hono-shaking": patch
---

Rework the progress output so each step occupies a single, in-place
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
