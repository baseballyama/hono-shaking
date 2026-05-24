---
"hono-shaking": patch
---

When stderr is a TTY, the heartbeat now animates in place on a single
line instead of appending a new `… working Xs` line every two seconds.
The TTY check is made through `tty.isatty(2)`, and the worker writes
`\r\x1b[K` + spinner frame + elapsed seconds, leaving the previous
output intact. Under non-TTY runners (CI logs, file redirection) the
original line-based heartbeat is kept because `\r`-only writes don't
flush through line-buffered pipes.
