# The store and search

Detail for [`ARCHITECTURE.md`](../ARCHITECTURE.md) §15 and §16: the cache tables, schema changes,
and search.

**Status 2026-09-22: built. SQLite behaviour measured on both runtimes that day; the commands for
shared groups are not built.**

## A group member is a person, not a contact

`people` holds everyone MAX can name for us; `chat_members` holds who is in what. **A contact is what
the query asks for, not a column** (`NEED-105`):

```sql
SELECT p.* FROM people p
  JOIN chat_members m ON m.person_id = p.id
  JOIN chats c        ON c.id = m.chat_id AND c.kind = 'dialog'
```

- A group member is stored and joinable but never in `contacts list` — outside the query, not hidden
  by a flag.
- **"Which groups do I share with this person"** is one indexed lookup (`chatsWith`): every stored
  chat includes the owner, so a person's chats *are* the shared set — no self-join, no row for us.
- The reading commands for that are not built, on purpose: a command nobody uses is maintained
  forever. The data is there for when somebody wants them.

| column | why it is there |
|---|---|
| `last_messaged_at` | the default order. Stored, not derived: a per-person maximum on every listing is the work a store exists to avoid. Written in the same transaction as the rows it orders |
| `source` | how we met them — `login`, `info`, `participant`, `sync`. **Diagnostic**, never the filter |

Names merge with `coalesce`, not assignment: the login, `CONTACT_INFO` and participant lists do not
all carry a username or description, and overwriting with an omission would blank a known name.

⚠ **`chat_members` is the one place that deletes**, per chat, never globally. MAX restates a chat's
whole membership with the chat, so a missing member has left; a missing *person* in a delta is just
unchanged. Clearing the whole table would empty it on one quiet login.

## A version bump is a rebuild, and that is a re-sync

- `migrate` drops every table (names from `sqlite_master`, not a list of what old versions wrote) and
  recreates them. Everything comes back from MAX; a column-by-column migration would run once, never
  be tested, and corrupt somebody's file on the second change.
- A file from a **newer** `max` is refused, not written to.
- The `fetched` row is dropped too; kept, it would claim a just-emptied collection is complete, and
  the offline path would believe it.
- ⚠ **This stops being right once the store holds something MAX cannot re-send** — contacts in no
  chat (`RES-7`). Then v2→v3 becomes `ALTER TABLE … ADD COLUMN` and this section is rewritten.

## It never fails the command

Nobody asked for the store, so a locked database or full disk must not lose an answer MAX already
gave: `contacts list` falls back to what the login carried, and the reason goes to stderr. Quiet is
fine; *invisible* is not — the cache was off on every machine for a day because it swallowed its
reason (`NEED-97`). The fallback loses SQL ordering and paging (an in-memory slice does worse), never
the answer.

## Searching: why FTS5 and not `LIKE`

Three indexes — `chats_fts`, `people_fts`, `messages_fts` — with `content=` (external content): the
index reads text back from the tables by rowid, so there is **no second copy of the words**, the file
does not double, and message bodies get no second home.

⚠ **`LIKE`, `lower()` and `COLLATE NOCASE` fold case for ASCII only.** Measured 2026-09-22 on SQLite
3.53.3: `LIKE '%иван%'` does not match `Иван Петров`, nor do the other two. A search on them silently
misses half a Russian address book, and a short list reads as complete. FTS5 tokenizers fold any
alphabet — the reason this is FTS5.

⚠ **`trigram`, not `unicode61`.** Same day: `unicode61` matches words and prefixes, so `етро` finds
nothing; `trigram` matches inside words and finds `Иван Петров`. `chats.resolve` has always used
`includes()`, and two name searches in one tool must agree.

Both runtimes, identical: `node:sqlite` 3.53.3 and `bun:sqlite` 3.53.0 ship FTS5 with `trigram` and
external content, no flag, no rebuild.

### Three things that bite

- **Trigram cannot answer a query under three characters** — it returns nothing, not an error. So the
  client refuses it (`checkedQuery` in `src/client.ts`) on every path, even with no cache open where
  a JavaScript filter could cope, so the answer never depends on whether a cache exists.
- **What the person typed is data, not a query.** FTS5 parses its argument: `O'Brien` is a syntax
  error, `a-b` a missing column, a lone `"` never ends; a chat named `O'Brien & Co` would crash the
  command. `phrase()` in `src/cache/store.ts` wraps input as one literal, doubling inner quotes — the
  only place a `MATCH` argument is built.
- **An external-content index does not follow its table.** Without a trigger, a renamed chat still
  matches its *old* title and returns the new name — no error. SQLite reuses freed rowids, so a
  deleted chat can leave its words to the next. Hence triggers, not TypeScript writes: four write
  paths, and forgetting one is invisible. Verified against the real statements —
  `INSERT … ON CONFLICT DO UPDATE`, with `people` using `coalesce` — not a plain `UPDATE` the code
  never issues.

### Searching messages is the one read that never connects

MAX has no search operation in our registry. `max messages search` opens no socket and spends no
login — the opposite of every other read (`df6792a`: the record does not answer a read).

⚠ **So it finds what has been read, not what exists.** An unopened chat contributes nothing and the
answer cannot know it; the command says so on stderr. `--chat` takes an id, not a name: resolving a
name needs the chat list, which needs the login this command promises not to spend.
