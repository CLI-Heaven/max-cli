# Settings: the file and paging

Detail for [`ARCHITECTURE.md`](../ARCHITECTURE.md) §14. The user-facing reference is
[`configuration.md`](../configuration.md) and [`usage.md`](../usage.md); this page keeps the rules
and the traps behind them.

**Status 2026-09-20: built.**

## The file

`~/.config/max-cli/config.json` (`$XDG_CONFIG_HOME`, or the OS convention), mode `0644`, read by
`cli-core`'s `loadConfigFile`. Fields: `defaultProfile`, and per profile `limit`, `timeoutMs`,
`color`, `record`, `keepRunsForDays`.

- **Missing file: not an error.** Malformed: an error in every output mode, naming the field. The
  schema is `strictObject`, so `"limitt"` reports `profiles.default.limitt`; plain `object()` would
  drop it silently. The **opposite** of MAX answers, where unknown fields are kept (`NEED-35`).
- **No field can hold a secret** (token, phone, chat id). Nowhere to put one beats a rule.
- `limit` applies to every command with `--limit`, including `contacts list`. `timeoutMs` unset is
  the transport's 30 s (`src/protocol/connection.ts`); `color` unset means decide from the terminal.

## Paging, identical on every listing

`--limit <n>` (default: `limit`, else 20), `--page <n>` (1-based), `--all` (no paging).

- `--page` with `--all` is a `validation_error`. Both resolve in `resolveSettings` beside `limit`,
  so no command re-derives the offset; **neither has a config field** (a page number in a file is
  nobody's setting). Paging is SQL `LIMIT ? OFFSET ?` over the store, not a slice of a full list —
  slicing stops being acceptable once the store is the authoritative copy.
- ⚠ **A page number over a live list can repeat or skip a row** (most-recent-first; a new message
  shifts the boundary). Documented in `--help`, not engineered away.
- **`messages list` pages with `--before`** instead: history is anchored in time (`chats.history`
  takes `from`), so it is exact. It takes a message id, or an ISO 8601 time when the id cannot be
  resolved (a deleted message is gone from MAX's history too).
- ⚠ A bare integer is **always** an id. Ids have 18 digits, ms timestamps 13; telling them apart by
  size breaks when either changes. ISO 8601 for times makes confusion impossible.
- `contacts list --order recent|name` (default `recent`) is a flag with no config field: a
  `contactOrder` setting would be a second spelling, which is why `--profile` was deleted.
