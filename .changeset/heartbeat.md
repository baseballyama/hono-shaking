---
"hono-shaking": patch
---

Print an elapsed-time heartbeat every 2 seconds while long phases are
running so the tool no longer looks frozen during the 5–20 second
`discoverProject` and per-server / per-client scans in large
monorepos.
