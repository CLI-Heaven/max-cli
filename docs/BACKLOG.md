# Backlog

Everything not yet built, one line per item. A closed item is **deleted** from here — the trail
stays in git history, and in `BACKLOG_DONE.md` once a first closed item starts that file.

The brief this is cut from: [`REQUIREMENTS.md`](REQUIREMENTS.md). The plan for the current
thread: `docs_ai/plans/` (local only, not committed).

**Working as of 2026-09-20**: seven operations under five commands — `session start|end`,
`account show`, `chats list`, `contacts list`, `messages list|send` — verified against the real
MAX, and every request they send is built from the specification in `src/spec/`. The profile is
the first word, every setting comes from one resolver, `--verbose` shows each request as it
happens and `--record` keeps it under `max runs`. What each part does and why is
[`ARCHITECTURE.md`](ARCHITECTURE.md); what was ruled is [`DECISIONS.md`](DECISIONS.md).

⚠ **Correction 2026-09-20: this line still listed `login`, `me`, `send` and `logout`** — the names
`NEED-48` replaced on 2026-09-19. They have not existed since.

<details>
<summary>Rules of this file — read once</summary>

- **A number is a permanent address.** Commits, code comments and plans cite it. A number is never
  reused. Take the next one like this, not by eye:
  ```sh
  git pull --ff-only
  grep -ohE '<PREFIX>-[0-9]+' docs/BACKLOG.md | sort -V | tail -1
  ```
- **Prefixes, and nothing invented:**

  | | |
  |---|---|
  | `RES` | research: reading someone else's code, protocol archaeology, a proof of concept, a decision that needs evidence before it can be made |
  | `OPS` | repository, tooling, CI, release |
  | `CORE` | `cli-core` — the vendor-neutral foundation shared with `braze-cli` |
  | `SPEC` | the protocol specification, the generator, generated output, coverage |
  | `MAX` | `max-core` — domain models, the client adapter, transport, session |
  | `CLI` | commands, options, output, profiles — everything a person or an agent types |
  | `DOC` | handwritten documentation |

  Findings carry the journal's own prefixes (`FIND`, `BUG`, `SEC`, `PERF`, `UX`, `IDEA`, `RISK`,
  `DEBT`) and are allocated by `docs_ai/journal/note.sh` (local only). A finding that turns into
  work gets a backlog number too, and the journal entry keeps a pointer.
- **The title is the task, not the symptom.** "Close the transport on every exit path", not
  "the command hangs".
- **One line, with an anchor in it.** A `REQUIREMENTS.md` section or a `path:line` — it points at
  where the work starts. Analysis goes elsewhere: an owner's ruling into
  [`DECISIONS.md`](DECISIONS.md), a deletion into `docs_ai/CLEANUP.md` (local only), a plan into
  `docs_ai/plans/` (local only).
- **Priority.** **P1** blocks other work or breaks something real · **P2** needed this cycle ·
  **P3** someday. Rank honestly; a backlog where everything is P1 says nothing.
- **Mark.** Empty — not started · 🟡 half done, the remainder named in the line · ⏸️ deferred by
  the owner · 🚩 waiting on an owner decision, not on code.

</details>

---

**Ten items below came from the `tgcli` comparison** (`NEED-112`) — `CLI-8`…`CLI-13`, `MAX-12`,
`MAX-13`, `DOC-3`, `RES-8`. The comparison itself is `docs_ai/tgcli-comparison.md` (local only):
every command of another personal-account messenger CLI sorted into what we have, what is queued,
what the brief rules out, and what was in neither. Only `CLI-8`, `CLI-9` and `CLI-10` are in the
release; `MAX-12` is `P1` on its own account (`NEED-113`).

## Done, and where the trail went

The architecture proposal, the `cli-core` extraction, the vertical slice and contacts are all
closed. `RES-1`, `RES-2`, `RES-3`, `CORE-1`…`CORE-4`, `MAX-1`…`MAX-3`, `MAX-6`, `CLI-1`…`CLI-3`,
`OPS-1`, `OPS-2`, `OPS-5`, `OPS-6`, `OPS-7` — their reasoning lives in
[`ARCHITECTURE.md`](ARCHITECTURE.md) and [`DECISIONS.md`](DECISIONS.md), and the proposal itself is
in `docs_ai/plans/` on the machine that did the work.

The specification and its generator closed the same way: `SPEC-0`, `SPEC-1`, `SPEC-2` and
`OPS-3`. Every opcode and payload shape is declared once in `src/spec/`, the registry, the
operation table, the wire wrappers and [`protocol.md`](protocol.md) are generated from it, and CI
regenerates and asserts the tree did not change. `OPS-8` closed with it: the tests are typechecked
now, in their own pass. How to add an operation is
[`ARCHITECTURE.md`](ARCHITECTURE.md) §12; what was ruled is `NEED-7`, `NEED-34` and `NEED-35`.

**Still open from that phase:**

- **RES-5** · 🟡 P2 · Whether `LOGIN` itself moves presence or read state. Reading history does not
  (we never send `CHAT_MARK`, and a test asserts it), but the login flag `interactive` is
  unexplained by every source. Needs a second device watching.
- **DOC-1** · ✅ Closed — [`ARCHITECTURE.md`](ARCHITECTURE.md) exists and describes working code.
- **DOC-2** · ✅ Closed 2026-09-21 — nine pages in Russian plus a `CHANGELOG.md`, indexed by
  [`README.md`](README.md). The three things it was meant to do better than the sibling's all
  landed: the command reference is generated (`OPS-10`), [`diagnostics.md`](diagnostics.md) is a
  page the sibling has no equivalent of, and [`security.md`](security.md) says plainly what the
  tool does **not** do. What remains of the release is `OPS-4`: publish.
  Owner's instruction 2026-09-20. The shape is the sibling's — `../braze-cli/docs/README.md` lists
  eleven pages, each answering one question — and three things are meant to be better than it:
  (a) the command reference is **generated** and CI-checked, never hand-written (`OPS-10`);
  (b) a page for the diagnostics, `--verbose`, `--record` and `max runs`, which the sibling has no
  equivalent of and which is what an agent-driver needs; (c) it is written in Russian.
  **Language is settled (`NEED-108`): everything written from now on is Russian, and the English
  documents that already exist are left alone** — a new section inside one of them follows the
  language of the file it lands in. Ships with `OPS-4`; plan:
  `docs_ai/plans/2026-09-20-first-release.md`.
- **DOC-3** · P2 · **The file an agent is pointed at, rather than a person.** `tgcli` ships a skill
  its users install in one line, and it is not a list of flags — it is a list of traps, with the
  boundary of what the tool is not for. `DOC-2` is documentation for a person and `OPS-10` is a
  generated option table; neither is this, and `README.md` claims the tool is built for agents
  first. Half the content is already written: `docs_ai/HANDOFF.md` §4 — ids past 2⁵³ are strings,
  a retry reuses the same `cid`, reading never marks anything read, the first word is the profile,
  and `MAX_CONFIG_DIR` moves the keyring entry. From the `tgcli` comparison (`NEED-112`).

## Repository and tooling

- **OPS-4** · **P1** · **The first release worth sharing.** Owner's instruction 2026-09-20: a
  version he can hand to somebody. Not "publish what exists" — the pieces are the plan
  `docs_ai/plans/2026-09-20-first-release.md`: the version — `0.1.0`, set 2026-09-20 (`NEED-107`) —
  a `CHANGELOG.md`,
  `docs/releasing.md` taken from the sibling, the npm publish itself, and `DOC-2` beside it
  (`OPS-10`, its command reference, is done),
  because a release nobody can read the instructions for is not shareable. `pnpm version:check`
  exists and runs in CI as of 2026-09-20.
- **OPS-10** · ✅ Closed 2026-09-20 — [`commands.md`](commands.md) is written by
  `scripts/commands.ts` from the command tree, on every `pnpm generate`. It needed no new CI step:
  the staleness check that already guarded [`protocol.md`](protocol.md) guards it too, and the
  suite compares the committed page with what the generator produces right now.
- **OPS-9** · P3 · `scripts/probe.ts` does not run — the command in its own header fails on the
  first import, because Node's type stripping will not resolve a `.js` specifier to a `.ts` file.
  `scripts/id-shape.ts` shows the working shape: import from `dist/` and build first. It also
  calls opcode 16, which is an update, against a real account.

## The foundation

`CORE-6` is closed: measured 2026-09-19, `node:sqlite` works on Node 22.23.2 with no flag and a
write-then-read round trip returns what it stored. It prints an experimental warning to stderr
there, which `NEED-59` leaves alone.


- **CORE-5** · ⏸️ P2 · Move `braze-cli` onto the extracted `cli-core` rather than leaving it on its
  own copy — the whole point of extracting rather than copying. Another repository, so it is its
  own change, and it does not block anything here. **Deferred by the owner 2026-09-20 until after
  the first release** (`OPS-4`): it improves a repository that is already working, while nothing of
  this one is installable yet.

## The protocol

- **RES-7** · P3 · Capture what a real MAX client sends as opcode 36's payload. Measured
  2026-09-20 (`pnpm probe:contacts`): the opcode exists and validates its arguments — `{}` and
  `{marker}` are refused `proto.payload`, `{marker, count}` closes the connection — so the shape
  cannot be guessed, only watched. It is the only route to contacts who are in no chat; `MAX-10`
  no longer waits on it. Replaces `RES-6`, which is closed: the probe it asked for ran on 2026-09-20.
- **SPEC-3** · P2 · Sanitized protocol fixtures under `fixtures/protocol/`, synthetic values only
  — never a real phone number, token, chat id or message (§24). The seed exists: response shapes
  are already exercised against made-up payloads in `src/spec/`.
- **RES-8** · P3 · **Does `MSG_SEND` carry a reply, and what is `elements`?** Two of the ordinary
  send options cannot be specified without knowing: a reply to a message, and text markup. Our
  request declares `elements` and we always send it empty (`src/spec/operations/messages.ts:22`);
  that it encodes markup the way Telegram's entities do is a guess from its name, and no frame with
  a non-empty one has been seen. Nothing here is estimable until a real client is watched sending
  both. Blocks the rest of `CLI-11`'s siblings; from the `tgcli` comparison (`NEED-112`).
- **SPEC-4** · P3 · A generated coverage document: which documented operations are implemented
  (§8, §30). Deferred on purpose — counting what MAX has that we do not means maintaining a list
  of MAX's whole surface, which is the research database §10 warns against.

## MAX

**`MAX-7` and `MAX-10` are closed.** The SQLite cache is behind a driver seam, with `--offline` and
`max cache clear`. The login now carries the stored marker in all four fields, so only a profile's
first login fetches everything, and the delta, the memberships and the marker go in on one
transaction. `contacts` became `people` with `chat_members` beside it, everybody in a group is
named rather than only the other half of a dialog, and `max contacts sync` forgets the marker when
a store needs re-taking. [`ARCHITECTURE.md`](ARCHITECTURE.md) §7 and §15.

- **MAX-4** · 🟡 P2 · Chat addressing: names work now, and what is left is the parts nobody has
  needed yet — a `@username`, a phone number, a chat you are not in.
- **MAX-11** · P2 · Persist the rotated token the login response returns (`NEED-106`, `NEED-8`).
  Today `session.login` answers with a `token` field and `MaxClient.connect` drops it, so the
  session keeps the credential that was pasted in months ago. Write it to the keyring **after** a
  successful login only, keep the old one if that write fails, and print neither. Its own commit
  and its own live check: it changes what is in the owner's keyring.
- **MAX-12** · **P1** · **Two keyring defects, as one change, with a live check** (`NEED-113`).
  **`session start` writes the token before it verifies it** (`src/commands/session.ts:40`), so a
  typo or an expired token destroys the working one with no way back — `Credentials.write`
  overwrites unconditionally and a keyring entry cannot be read out again, which is how two working
  keys died in `brazecli` on 2026-09-14 (`../cli-core/src/credentials.ts:20-31`). **And nothing
  checks whose account a profile's token belongs to**: `viewerId` is written on every login
  (`src/client.ts:383`) and never compared, so a token belonging to someone else sends as them in
  silence. Same files, same test run, same live check as `MAX-11`, and worth doing beside it.
- **MAX-13** · P3 · **Search the cache by text.** The store already keeps message bodies indexed by
  chat and time, with `ranges` recording which windows are held completely
  (`src/cache/schema.ts:78-121`), and nothing reads any of it by text. Wants FTS5 — and a decision
  about the tokenizer, because `unicode61` without a stemmer finds only the exact Russian word
  form. Whether MAX has a server-side search of its own is unknown; this one is local either way.
  From the `tgcli` comparison (`NEED-112`).
- **MAX-8** · P3 · Telemetry as other clients send it — a later phase, and only once our own
  traffic is understood (`NEED-16`).
- **MAX-9** · P3 · The rest of the messenger surface, in the order of §35: attachments and
  reactions when reading, then uploads, reactions, edits and group administration when writing.
  Stories and calls last.

## The command

**`CLI-4`, `CLI-6` and `CLI-7` are closed.** The configuration file, the order a setting is decided
in, the profile as the first word, `--quiet` over the protocol note, and `--verbose` with the run
log are all built; `"record": true` and `keepRunsForDays` now reach `src/runs/recording.ts` through
`resolveSettings` (`src/commands/context.ts`). How it works is
[`ARCHITECTURE.md`](ARCHITECTURE.md) §13 and §14.

`CLI-7` is the paging work: `--limit`, `--page` and `--all` on every listing, resolved once and
pushed into SQL; `contacts list` ordered by who was last messaged and taking `--order`;
`messages list` paging by `--before` instead; and a machine-mode listing answering
`{items, page, limit, hasMore}` rather than an array, with `README.md`,
[`ARCHITECTURE.md`](ARCHITECTURE.md) §10 and §14 and `scripts/verify-commands.ts` moved with it
(`NEED-81`, `NEED-86`).

⚠ **Paging was `CLI-6` in the plan and is `CLI-7` here.** `fd023bc` gave it the new number because
`CLI-6` already meant the run-log settings, and left the old copy behind; the plan and its handoff
were written before that and name the number that was taken (`FIND-35`). A number keeps its
meaning: `CLI-6` is the settings item.


- **CLI-8** · P2 · **`--silent` on `messages send`.** The wire already carries it — `notify` is in
  the request (`src/spec/operations/messages.ts:22`) and `MaxClient.messages.send` takes it
  (`src/client.ts:310`); only the flag is missing. Ships with `OPS-4` (`NEED-112`).
- **CLI-9** · P2 · **Filters on the listings, and a way to see which profiles exist.** `chats list`
  and `contacts list` take only `--limit` (`src/commands/chats.ts:9`,
  `src/commands/contacts.ts:18`), so "every chat matching *work*" cannot be asked for at all —
  `chats.resolve` is not a substitute, it answers with one id and refuses ambiguity. Wants
  `--query`, and a filter by kind, which MAX distinguishes and we already map
  (`src/domain/map.ts:96-107`). The profile list can land in `CLI-12` instead; it must land
  somewhere. Ships with `OPS-4` (`NEED-112`).
- **CLI-10** · P2 · **`--timeout` bounds the command, not one request.** `timeoutMs` is how long to
  wait for one opcode answer (`src/protocol/connection.ts:75`) and comes only from the
  configuration file, while a read is connect + INIT + LOGIN + resolve + history — so an agent
  given a thirty-second budget has no way to say so. Settle the environment layer with it: the
  resolver's own comment promises flag-then-environment-then-file and only `MAX_PROFILE` has the
  middle one (`src/config.ts:77`, `src/config.ts:90`). Ships with `OPS-4` (`NEED-112`).
- **CLI-11** · P2 · **The message body from stdin.** It is a positional argument
  (`src/commands/messages.ts:52`), so it is read by `ps` and kept by shell history — the thing
  forbidden for the token two lines away — and a multiline message breaks. The other CLI carries
  the same wound and patched it with a helper script instead of a flag. From the `tgcli`
  comparison (`NEED-112`).
- **CLI-12** · P2 · **`max doctor`, and reading the effective settings.** Nothing shows the state a
  command depends on, and one trap has no other way of being seen: `MAX_CONFIG_DIR`,
  `MAX_STATE_DIR` and `MAX_CACHE_DIR` change the keyring service name, so a login under them
  answers "no session" without them (`docs_ai/HANDOFF.md` §6). It prints the profile and where it
  came from, the profiles that exist, the config file and whether it parsed, whether a token exists
  and from which source, the login count and the last login (`src/session/store.ts:14-21`, which is
  what `RISK-2` wants counted), the cache file and its schema version, and the run directory.
  `--connect` separately, because reaching MAX costs a login. Answering "is there a session at all"
  is part of it — today that question costs a real command. From the `tgcli` comparison
  (`NEED-112`).
- **CLI-13** · P3 · **Reading past a window of one chat.** `messages show <id>`, and
  `messages context <id> --before N --after N` — a window either side of one message rather than
  only what came before it. `messages list --before <id-or-time>` already walks backwards
  (`src/commands/messages.ts:21`), so what is missing is one message by id and the forward half.
  Sits on `MAX-13` for anything older than the cache holds. From the `tgcli` comparison
  (`NEED-112`).
- **CLI-5** · P3 · The debug escape hatch — `max raw` / `max protocol invoke` — spec-validated,
  explicitly advanced, never arbitrary packet injection (§22).

## Risks carried

- **RISK-2** · P2 · A login per command may exhaust the session token. One reverse-engineering
  document reports a reset after ~30–50 logins "in a short interval" and defines neither the
  interval nor a symptom beyond "the connection closes right after INIT"; no other source mentions
  it. Proposal §11.1: persist the rotated token the login response returns, name the symptom in an
  error message, count logins — and do not refuse on a ceiling nobody has measured (`NEED-8`).
  **First number of our own, 2026-09-21: 65 logins accumulated on the real account with nothing
  broken** — `max doctor` (`CLI-12`) is what would make that readable without opening a file.

## Known unknowns

- **PROTO-1** · 🟡 P2 · What opcode 36 actually returns. tsmax and PyMax call it `CONTACT_LIST`,
  the protocol documentation calls it `GET_BLOCKED`. Sent once on 2026-09-20 with the owner's
  permission: **it exists and validates its payload**, but none of `{}`, `{marker}` or
  `{marker, count}` is right and the last closed the connection. What is left is a traffic
  capture — `RES-7`.
- **PROTO-2** · P2 · How long MAX remembers a `cid`. The retry rule rests on deduplication measured
  seconds apart; a retry minutes later is unproven.
- **PROTO-3** · P3 · The upper bound on `chatsCount` in `LOGIN`. 100 works, 200 is refused as "out
  of range"; the boundary is somewhere between. The specification caps it at 100 meanwhile.
- **PROTO-6** · P3 · What `messages` in the `LOGIN` answer actually holds. Measured 2026-09-20: it
  is an **object**, not the array the specification declared, and nothing in the code reads it —
  `src/spec/operations/session.ts` now says `unknown` rather than guessing. **`pnpm probe:ids`
  reports its type and key count**, so one run on the account closes this; it prints the shape,
  never the contents.
- **PROTO-5** · P3 · How long a message id can get, and whether a chat id ever crosses 2⁵³.
  Measured 2026-09-19 over 25 chats and 6 contacts: chat ids reach 14 digits, contact ids 9, none
  past 2⁵³. The login carried no messages that run, so the 18-digit message id remains a single
  earlier observation — and message ids are only ever read, never sent.
