---
"hono-shaking": minor
---

feat: warn on dead config entries; add `--fail-on-dead-config`

Ignore rules in `hono-shaking.config.ts` (`ignore.routes[]`,
`ignore.orphans[]`) that never match anything during a run are now
reported as warnings on stderr by default, so stale entries don't quietly
outlive the routes they were written for. A rule is also reported as
unmatched when an earlier broader rule fully shadows it — both forms are
effectively dead config the user probably wants to clean up.

Two new CLI flags:

- `--fail-on-dead-config` — exit `1` if any ignore rule was unmatched.
  Useful in CI to keep the config from rotting as routes are renamed
  or removed.
- `--no-warn-dead-config` — silence the warning (default is to print).

The library API gains `IgnoreFilter.getUnmatchedRules()` and an
`UnmatchedConfigRule` type for callers that want to render their own
report.
