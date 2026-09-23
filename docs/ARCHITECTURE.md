# Architecture

How this repository is put together, and which seams you may not cross.

**Status 2026-09-20: this describes working code, not a plan.** Seven operations run against MAX;
`max cache` and `max runs` answer from this machine. Both runtimes pass. Everything here was
verified against the real service unless it says otherwise. Round trip re-verified live 2026-09-20:
`max chats list --limit 3 --verbose --record` made three requests, stdout was one JSON value, stderr
only the event lines.

"Brief §N" is [`REQUIREMENTS.md`](REQUIREMENTS.md); rulings (`NEED-nn`) are in
[`DECISIONS.md`](DECISIONS.md). Long detail lives in companions under `architecture/`:
[`session.md`](architecture/session.md) (§7), [`messages.md`](architecture/messages.md) (§10),
[`store.md`](architecture/store.md) (§15, §16).

---

## 1. One published package, four layers, one direction

```text
     src/commands/     session · account · chats · contacts · messages · cache · runs
            │          speaks the domain model, owns no protocol knowledge
            ▼
     src/client.ts     MaxClient — the only thing above here that knows MAX exists
            │          client.chats.list() · client.messages.send() · client.account.me()
    ┌───────┼────────────────┬──────────────────┐
    ▼       ▼                ▼                  ▼
 src/domain/  src/spec/          src/generated/    src/protocol/
 Chat         one operation,     opcode registry   frame codec
 Message      declared once      operation table   connection
 Contact      Valibot schemas    wire wrappers     seq correlation
 mapping      provenance         never hand-edited
                                         ▲
                        src/session/   handshake (INIT → LOGIN) · keyring · state
                        src/cache/     the record, behind a driver seam per runtime
                        src/runs/      one event per request · the run directory
```

- Commands are resource + action (`NEED-48`); the diagram matches `max --help`. Adding an operation:
  §12.
- [`@leemour/cli-core`](https://github.com/leemour/cli-core) supplies output streams, renderer,
  error model and exit codes, keyring, config and clocks — the non-MAX half, shared with
  `braze-cli`.
- **One npm package** (`@leemour/max-cli`, command `max`), split by directory, not workspace
  (`NEED-12`). **`src/commands/` may not import from `src/protocol/`, `src/spec/` or
  `src/generated/`**: a Biome rule fails the build with that sentence. Verified by writing the
  forbidden import, both directions.

## 2. What each layer may know

| Layer | Knows about | Must never |
|---|---|---|
| `commands/` | `Chat`, `Message`, `Contact`, the renderer, exit codes | opcodes, frames, `ws`, MAX field names |
| `client.ts` | opcodes, the session, the domain model | rendering, `process.stdout`, argv |
| `domain/` | MAX's wire shapes, and only to translate them out | the network, the session |
| `spec/` | every operation, its shape and where it came from | the socket, the session, output |
| `generated/` | what follows from `spec/` | being edited by hand |
| `protocol/` | frames, seq, the socket | who is asking or why — **including the handshake** |
| `session/` | the keyring, the state file, INIT → LOGIN | anything it can ask `cli-core` for |
| `runs/` | what a request cost, and where a record of it goes | what a request *said* — §13 |

Why: if MAX's transport changes, only `protocol/` and `client.ts` change. That is why we own the
adapter instead of depending on `@bruch/max-client` (`NEED-17`).

## 3. The WebSocket is JSON, and ids are the reason to be careful

Frames are text `{ver: 11, cmd, seq, opcode, payload}`; `cmd` 0 request, 1 response, 3 error.
MessagePack, LZ4 and zstd are the **TCP** transport, which we do not use.

⚠ **Never `JSON.parse` a MAX frame.** Measured on a real account: message ids have **18 digits**,
past `Number.MAX_SAFE_INTEGER`; the built-in parser rounds them and two messages can get one id.
Measured 2026-09-19 over 25 chats and 6 contacts (`pnpm probe:ids`): chat ids reach **14 digits**,
contact ids **9** — safe. So ids we *send* are not at risk; ids we *read* need the lossless codec. A
"19-digit chat id" in the code was an illustration, not a measurement, and is corrected.

`src/protocol/frame.ts` parses with `lossless-json`, returns a `bigint` for anything unsafe, and
**every id leaves it as a string** — an id is never arithmetic.

`seq` is the only link from answer to question: MAX interleaves pushed events with responses on one
socket, so "the next frame is my answer" eventually reads somebody's incoming message.

## 4. One command, one connection, and it closes

- `connect → do the thing → print → close`, the close in a `finally`. `Connection` owns the socket,
  per-request timers and listeners; `close()` clears all three. ⚠ An open WebSocket or live timer
  keeps Node alive, so `max chats list --json | …` would never return: **print-then-hang is a
  defect.**
- `INIT` (6) then `LOGIN` (19) come first; MAX answers nothing before them. The handshake is
  handwritten in `src/session/handshake.ts` and stays so (brief §9); the spec supplies its two
  payloads, so field names have one home, not two. It gets the client's `invoke`, not the socket, so
  both requests are checked and reported like any other (§13).
- LOGIN returns profile, chats, contacts, recent messages and presence, so `account show` and `chats
  list` need **no further request**. `PROFILE` (16) is a profile *update* and refuses an empty
  payload — not used for reading.
- `interactive: false` on login and history (the web client sends `true` for a watching person).
  Whether it moves presence or read state is not settled (`RES-5`).

## 5. Reading is observational, by construction

`CHAT_HISTORY` (49) and `CHAT_MARK` (50) are separate. We never send 50; `src/client.test.ts`
asserts opcode 50 is absent from everything sent.

⚠ Until the spec landed (2026-09-19) that assertion compared against a missing `Opcode.CHAT_MARK`,
so it read `not.toContain(undefined)` and always passed — `tsconfig.json` excluded test files
from type checking (`OPS-8`). 50 is now a declared opcode with the reason it is never sent.

Not proven: whether `LOGIN` itself moves presence. Needs a second device watching.

## 6. A send may be retried, and only because it was measured

Unlike Braze ("never retry a write"): **`MSG_SEND` carries a client-generated `cid`, and MAX
deduplicates by it.** Measured 2026-09-19 in Saved messages: the same `cid` twice gave the **same
message id** and **one** copy, also across two connections and logins — the case a retry faces.

- A lost send is retried **once, with the same `cid`**. If that fails too, the result is
  `outcome_unknown` (neither failed nor sent) and names the `cid`; `max messages send --cid <n>`
  repeats it without risking a second copy.
- ⚠ Unmeasured: how long MAX remembers a `cid`. Both probes were seconds apart.
- `cid` is monotonic per process. `Date.now()` alone gave two sends in one millisecond the same
  `cid`, and deduplication would have silently dropped the second. A test caught it.
- `--silent` sends `notify: false` (normally `true`). ⚠ **Only `true` is measured**; what MAX does
  with `false` has never been observed (that means messaging somebody), so it may be ignored. The
  first use against a real chat settles it.

## 7. The session is a token and a stable identity

| What | Where | Why |
|---|---|---|
| token | OS keyring, service `max-cli`, account = profile | it is the credential |
| `deviceId`, `viewerId`, login count | `<state dir>/profiles/<name>.json`, mode 0600 | identifying, and it must be **stable** |

- **The device identity is saved the first time it is read**, before any use. Otherwise a failed
  login or a second call shows MAX a new device — what brief §34 forbids. Found by a test.
- `MAX_TOKEN` is read before the keyring (CI, probes). `max session start` imports a token obtained
  elsewhere, without echo; the phone-and-code flow is not built.

In [`architecture/session.md`](architecture/session.md):

- [Token exchange](architecture/session.md#the-token-is-replaced-when-it-has-gone-stale-and-kept)
  (`MAX-11`, measured 2026-09-22): LOGIN returns a new token once the old one has aged, then the same
  one. Stored after the account check; a keyring failure does not fail the command; never printed.
- [Login first, profile bound to one account](architecture/session.md#the-login-happens-first-and-the-profile-is-bound-to-an-account)
  (`MAX-12`, measured 2026-09-21): a token reaches the keyring only after MAX accepts it
  (`src/session/adopt.ts`); a profile refuses another account's token.
- [The login asks for a delta](architecture/session.md#the-login-asks-for-a-delta) (`MAX-10`,
  `NEED-103`, measured 2026-09-20, `pnpm probe:contacts`): the four `*Sync` fields are timestamps; we
  send the stored marker, written in one transaction with its rows. `max contacts sync` forgets it.
- [Chat members are named](architecture/session.md#a-chat-carries-its-members-and-we-ask-who-they-are):
  every group and dialog participant via `CONTACT_INFO`, batched at 100; channels skipped. 23 people
  in chats against 6 contacts (2026-09-20).

## 8. We look like the official client

Nothing on the wire names this tool (brief §34): `WEB_USER_AGENT` in `src/spec/identity.ts` is the
web client's shape, `Origin` is `https://web.max.ru`, the device identity is stable per profile.
We use `ws`, not Node's built-in `WebSocket`: measured on both runtimes, `ws` sends custom headers
identically; the built-in's support depends on the bundled undici version.

## 9. A name is never resolved by guessing

- `max messages list "Ivan"` matches chat titles, exact first, then as a fragment. **An ambiguous
  name is an error listing the candidates** — a send to the wrong chat does not undo. Verified live
  (a full contact name matched two chats; the command stopped). Candidates print one per line with
  ids, and in the machine error as `candidates: [{ id, title }]`, so an agent picks one without
  parsing a sentence.
- A dialog has no title, so the partner's name comes from contacts: one `CONTACT_INFO` (32) for all
  unknown partners. Measured: 6 contacts in the login against 17 dialog partners; named dialogs went
  from 0 of 17 to 16 of 17.
- The same lookup names **group senders** (`FIND-45`). The login names contacts only, so on
  2026-09-22 every sender in a real group but the owner was a bare id. After a history read, unnamed
  ids are looked up in the store, then in one `CONTACT_INFO`, and kept; the next read of that chat
  asks nothing. A refused lookup leaves the ids, notes it on stderr, and still answers.
- ⚠ Opcode 36 is `CONTACT_LIST` in tsmax and PyMax but `GET_BLOCKED` in the protocol documentation.
  **Not used** — not a difference to discover in production.

## 10. Output: stdout is data, stderr is everything else

`--json`, or any non-terminal stdout: **one JSON value on stdout and nothing else** — no spinner,
`✓`, warning or ANSI. Diagnostics go to stderr in every mode, so the contract holds by construction.
Verified live: stdout one JSON value, stderr empty. Failures too: `run()` returns an exit code
(never throws), the error goes to stderr (JSON when piped, a sentence in a terminal), codes from
`cli-core` (`4` authentication, `130` interrupt). Scripts branch on the code, never on text.

### A listing answers one object, always the same one

```json
{ "items": [ … ], "page": 1, "limit": 20, "hasMore": true }
```

- `chats list`, `contacts list`, `messages list`, every machine mode — also `--all` (`page: 1`,
  `hasMore: false`) and `--offline`. **The shape never says where rows came from**; exit code and
  diagnostics do.
- `hasMore` is a boolean, not a total (counting rows MAX has not sent is another cost). Exact for
  chats and contacts. ⚠ **For `messages list` it is a claim about our copy**: history comes in
  windows, and a full page is the only evidence of another.
- In a terminal, the "more pages" line goes to **stderr**, from `src/commands/paging.ts`, not
  `renderer.result`: `account show` and `session start|end` are not listings and answer a bare
  object.

User-facing version: [`usage.md`](usage.md). Messages print as a feed, not a table; a message id
holds its send time (`id >> 16`, measured 2026-09-22); a photo link opens without a token
(`NEED-120`); a reply carries the other message whole —
[`architecture/messages.md`](architecture/messages.md).

## 11. Trade-off order

When two conflict, the earlier wins:

```text
correctness > not touching someone's account by accident > auditability
> agent determinism > human UX > protocol coverage > implementation cleverness
```

The second ranks high because this is a real personal account: an unwanted send, a read receipt or a
message deleted by a retry happened to a person.

## 12. One operation, declared once

Every opcode and payload shape lives in `src/spec/`; its Valibot schemas **are** the definition
(`NEED-7`). `src/generated/` follows from it and is never edited by hand.

| Generated, committed, checked in CI | Handwritten, and staying that way |
|---|---|
| `src/generated/opcodes.generated.ts` — the registry | the socket, `seq` correlation, timeouts |
| `src/generated/operations.generated.ts` — the table | the INIT → LOGIN handshake |
| `src/generated/client.generated.ts` — wire wrappers | the schemas themselves — they are the spec |
| [`protocol.md`](protocol.md) — the reference page | the domain mapping, and error classification |

### Adding one

1. In `src/spec/operations/<subject>.ts`, `defineOperation`: dotted `name`, MAX's `constant`, the
   opcode, a **strict** request shape, a **loose** response shape, and where the shape came from.
2. `pnpm generate`. A duplicate opcode or name, or a name not `<group>.<method>`, stops it with a
   sentence naming both sides.
3. Call it from `MaxClient`. The generated wrapper is typed and stays internal.

**A known number we will not send gets `reserveOpcode`**, with the reason: it is in the registry but
never gets a method, so "do not call it because it is in the enum" is enforced by code.

### Two directions, two schemas

- **Requests are strict**: an unknown field is refused before the socket.
- **Responses are loose**: new fields pass through, fields we do not use are optional, nothing in a
  response fails a command (brief §29, `NEED-35`). Each answer is still checked against the spec; a
  mismatch is **one line on stderr**, so a renamed field does not silently blank a column.
- ⚠ **That note is built by hand from the field path and expected type.** Valibot's message quotes
  the value, which may be somebody's message (brief §14, §24). A test asserts no body reaches a
  note.

### An id is a string above the codec and a `bigint` on the wire

`asId` reads; `id()` in `src/spec/scalars.ts` writes. It replaced `Number(chatId)`, which silently
rounds past 15 digits (`Number("7268926000000000001")` is a different chat). Ids below 2⁵³ give the
same bytes as before. **It never mattered yet**: measured 2026-09-19, nothing the login returned was
past 2⁵³ (longest chat id 14 digits). Hardening, so nobody re-asks.

### Staleness

`pnpm generate` writes and formats in one step; CI regenerates and asserts no diff (`OPS-3`). The
banner has no date or version — anything that moves on its own makes that check fail forever.

## 13. One event per request, and the two places it can go

Each request is one object: direction, operation, opcode, `seq`, ids named, duration, bytes, how
many things came back. **Two sinks**: `--trace` renders it on stderr live; `--record` writes it to a
file. Either, both, or (default) neither. What it looks like and how to use it:
[`diagnostics.md`](diagnostics.md).

```text
→ session.login     op 19  seq 2  871 B
← session.login     op 19  seq 2  213ms  48.0 kB  25 chats  6 contacts
```

- **Never in an event: a chat title, a person's name, a message body, a phone number, a token** —
  not truncated, not hashed (brief §14, §24). Ids are in: opaque, only the session holder can
  correlate them, and every real complaint is about one conversation.
- ⚠ This holds because `idsOf` in `src/runs/events.ts` **builds the event from named fields instead
  of filtering the payload** (a filter lets an unseen field through). No branch reaches
  `session.login`'s `token`. Pino's redaction is the second line of defence.
- `MaxClient` takes an injected event sink, like `warn` — it reports, never decides where. The hook
  is in `#send` (builds, times, checks).
- ⚠ **`startSession` gets the client's `invoke`, not the socket** (since 2026-09-20). Before, it
  called `connection.invoke`, so INIT and LOGIN bypassed the hook, and `chats list` (nothing sent
  beyond LOGIN) recorded an empty run. It also made LOGIN's answer checked against the spec, which
  found `messages` is an object, not an array (`PROTO-6`).
- A request refused **before** the socket (bad id, unknown field) emits no event; the run still
  records outcome and code.
- **A local answer gets its own event shape**: no opcode, `seq` or bytes ("0 bytes" would be
  fiction), plus a `reason`: `offline` (caller said never connect) or `history` (window older than a
  fetch returns, so the record is authoritative). "Did not ask" and "nothing to ask" differ; only
  the second is the local copy doing its job.

### The run directory

`<state dir>/runs/<UTC day>/<timestamp>-<command>-<suffix>/` with `run.json` and `events.jsonl`.
[`diagnostics.md`](diagnostics.md) has the layout, modes (`0700`/`0600`), the twice-written
`run.json` (`running`, then the outcome) and 30-day retention, pruned only when a recorded run
starts, whole days by directory name. Rules not stated there:

- **Off unless asked** (`NEED-49`, `NEED-52`): `--record`, `--no-record`, else the config file.
- `run.json` is written atomically. `finish` runs on every path and **awaits the logger**: Pino
  appends via a plain stream, and a process that exits first loses the tail — the part somebody
  wanted.
- The day directory is UTC: a run at 01:35 in Madrid lands under the previous day.
- **Files, not the SQLite cache** (`NEED-51`): opposite lifecycles, and two `max` runs can overlap.
  Two appends never conflict; two DB writers take a lock, and a diagnostic must not fail its
  command.
- `max runs list | show <id> | path <id>` read them back. An empty list explains itself on stderr
  and names `--record`. **`runs path` answers `{"path": "…"}` too** (`NEED-88`, `max runs path <id>
  --json | jq -r .path`; a terminal gets the path on a labelled line): a contract with no exception
  is one nobody has to remember, and was worth more than `cat "$(max runs path <id>)/events.jsonl"`.

## 14. Settings, and the order one is decided in

**Flag → environment → config file → built-in default**, decided once in `resolveSettings`
(`src/config.ts`). Commands take what they are given; one that re-derived the order would disagree.
Every field, variable and the file format: [`configuration.md`](configuration.md); profiles and
paging for users: [`usage.md`](usage.md). The profile follows the same order: the first word
(`max personal chats list`), then `MAX_PROFILE=personal`, then `"defaultProfile"` in the file, then
`default`.

### The profile is the first word, not a flag

- `--profile` was deleted (`NEED-45`). The first word is the profile **unless it names a command**
  (`liftProfile` in `src/profile.ts`). It must come first: `max --json personal chats` reads
  `personal` as a command and fails.
- ⚠ **A profile named after a command could never be selected** (`max chats` must mean the command),
  so `max session start` refuses the name (`refuseCommandName`) — creation is the only moment to
  explain it. Names become file names and keyring accounts: letters, digits, `.`, `-`, `_` only.
- An unknown first word gets `authentication_error` naming that profile and the fix
  (`max x session start`, not `max session start`, which would log in the wrong profile). `max chat
  list` is the everyday case; the message says which word was read as what.

### The file and paging

What a user sets and how: [`configuration.md`](configuration.md), [`usage.md`](usage.md). The rules
behind it:

- `~/.config/max-cli/config.json`, mode `0644`, read by `cli-core`'s `loadConfigFile`. A missing
  file is not an error; a malformed one is, in every output mode, naming the field.
- The schema is `strictObject`: `"limitt"` is reported as `profiles.default.limitt`, where plain
  `object()` would drop it silently. The **opposite** of MAX answers, whose unknown fields are kept
  (`NEED-35`).
- **No field can hold a secret** (token, phone, chat id). Having nowhere to put one beats a rule.
- `timeoutMs` unset is the transport's 30 s (`src/protocol/connection.ts`); `color` unset means
  decide from the terminal.
- `--limit`, `--page` (1-based), `--all` on every listing, resolved once in `resolveSettings`;
  `--page` with `--all` is a `validation_error`. Neither `--page` nor `--all` has a config field — a
  page number in a file is nobody's setting. Paging is SQL `LIMIT ? OFFSET ?` over the store.
- ⚠ **A page number over a live list can repeat or skip a row** (newest first; a new message shifts
  the boundary). Documented in `--help`, not engineered away.
- `messages list` pages with `--before` instead, anchored in time (`chats.history` takes `from`), so
  it is exact. It takes a message id, or an ISO 8601 time when the id is gone.
- ⚠ **A bare integer is always an id.** Ids have 18 digits, ms timestamps 13; telling them apart by
  size breaks when either changes.
- `contacts list --order recent|name` has no config field: a second spelling of a flag is how
  `--profile` came to be deleted.

### Two things that jump the queue

- **`MAX_TOKEN` outranks the keyring** (`cli-core`'s `Credentials.read`) — a token for a container
  or probe without storing it.
- ⚠ **`MAX_CONFIG_DIR`, `MAX_STATE_DIR` and `MAX_CACHE_DIR` change which keyring entry a profile
  means.** `pathsAreOverridden` makes the service `max-cli:<configDir>`, so a login made with them
  is invisible without them ("no session" for a profile that exists). Same environment for both, or
  neither. This cost an afternoon (`UX-1`).

### Diagnostics all leave by one door

`--quiet` silences diagnostics only; a failure still prints, since an exit code says what kind of
thing failed but not which chat (`src/output.ts`). A `MaxClient` is built in exactly one place
(`src/commands/context.ts`), which hands it the renderer's `note`. Before, the protocol note went
straight to stderr, so `--quiet` missed it and `--json` did not shape it (`BUG-7`). Six commands
each remembering to pass a `warn` is a rule that breaks once and then stays invisible; one
construction site cannot.

## 15. The store: people, and the chats they are in

The cache database (`<cache dir>/<profile>.db`, mode `0600`, `SCHEMA_VERSION` 2) is **a record and
an offline source, never a way to skip a request**. Every read still asks MAX, since the login
returns chats, contacts and recent messages anyway; `--offline` alone answers from the record
without connecting. No freshness window: a stored person is valid until told otherwise.
`--offline` reaches the client in one place (`createClient` in `src/commands/context.ts`), and a
send under it is refused — until 2026-09-23 the flag reached no command, so `--offline messages
send` would have sent.

In [`architecture/store.md`](architecture/store.md):

- [A group member is a person, not a contact](architecture/store.md#a-group-member-is-a-person-not-a-contact)
  (`NEED-105`): `people` + `chat_members`; a contact is whoever shares a `dialog`, decided by the
  query. Group members are stored but never in `contacts list`. `chat_members` alone deletes, per chat.
- [A version bump is a rebuild](architecture/store.md#a-version-bump-is-a-rebuild-and-that-is-a-re-sync):
  `migrate` drops and recreates every table; a newer file is refused.
- [It never fails the command](architecture/store.md#it-never-fails-the-command): falls back to the
  login's data and says why on stderr (`NEED-97`).

## 16. Searching, and why it is FTS5 rather than `LIKE`

Three external-content FTS5 indexes (`chats_fts`, `people_fts`, `messages_fts`), `trigram`
tokenizer, kept in sync by triggers. `LIKE`, `lower()` and `COLLATE NOCASE` fold ASCII only and miss
Cyrillic names; `trigram` matches inside words like `chats.resolve`'s `includes()`. `max messages
search` never connects, so it finds what has been read, not what exists. Measurements, the three
traps (short queries, input as FTS5 syntax, index drift) and the offline rule:
[`architecture/store.md`](architecture/store.md#searching-why-fts5-and-not-like).
