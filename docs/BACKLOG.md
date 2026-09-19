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

- **RES-6** · P2 · Watch what opcode 36 actually returns — one read-only call on the real account,
  with the owner present — and close or re-write `PROTO-1`. It decides whether `max contacts sync`
  can mean "every contact" or only "everyone MAX has already named"
  (`docs_ai/plans/2026-09-20-contacts-and-paging.md` §3.1). Blocks `MAX-10`.
- **RES-5** · 🟡 P2 · Whether `LOGIN` itself moves presence or read state. Reading history does not
  (we never send `CHAT_MARK`, and a test asserts it), but the login flag `interactive` is
  unexplained by every source. Needs a second device watching.
- **DOC-1** · ✅ Closed — [`ARCHITECTURE.md`](ARCHITECTURE.md) exists and describes working code.
- **DOC-2** · **P1** · **The documentation a person installing this would open, in Russian.**
  Owner's instruction 2026-09-20. The shape is the sibling's — `../braze-cli/docs/README.md` lists
  eleven pages, each answering one question — and three things are meant to be better than it:
  (a) the command reference is **generated** and CI-checked, never hand-written (`OPS-10`);
  (b) a page for the diagnostics, `--verbose`, `--record` and `max runs`, which the sibling has no
  equivalent of and which is what an agent-driver needs; (c) it is written in Russian.
  **Language is settled (`NEED-108`): everything written from now on is Russian, and the English
  documents that already exist are left alone** — a new section inside one of them follows the
  language of the file it lands in. Ships with `OPS-4`; plan:
  `docs_ai/plans/2026-09-20-first-release.md`.

## Repository and tooling

- **OPS-4** · **P1** · **The first release worth sharing.** Owner's instruction 2026-09-20: a
  version he can hand to somebody. Not "publish what exists" — the pieces are the plan
  `docs_ai/plans/2026-09-20-first-release.md`: the version — `0.1.0`, set 2026-09-20 (`NEED-107`) —
  a `CHANGELOG.md`,
  `docs/releasing.md` taken from the sibling, the npm publish itself, and `DOC-2` beside it,
  because a release nobody can read the instructions for is not shareable. `pnpm version:check`
  exists and runs in CI as of 2026-09-20.
- **OPS-10** · P2 · A generated command reference — `docs:generate` writes `docs/commands.md`
  from the `commander` tree, `docs:check` fails CI when it drifts, exactly as `pnpm generate` and
  `git diff --exit-code` already do for [`protocol.md`](protocol.md) (`OPS-3`). Feeds `DOC-2`: the
  one page nobody should be writing by hand is the list of options.
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

- **SPEC-3** · P2 · Sanitized protocol fixtures under `fixtures/protocol/`, synthetic values only
  — never a real phone number, token, chat id or message (§24). The seed exists: response shapes
  are already exercised against made-up payloads in `src/spec/`.
- **SPEC-4** · P3 · A generated coverage document: which documented operations are implemented
  (§8, §30). Deferred on purpose — counting what MAX has that we do not means maintaining a list
  of MAX's whole surface, which is the research database §10 warns against.

## MAX

- **MAX-4** · 🟡 P2 · Chat addressing: names work now, and what is left is the parts nobody has
  needed yet — a `@username`, a phone number, a chat you are not in.

- **MAX-7** · P2 · The SQLite cache: chats, messages, contacts and their sync counters, behind a
  driver seam because `node:sqlite` and `bun:sqlite` are not the same module (`NEED-14`, `NEED-11`).
  Never the session token. Needs `--no-cache` and a clear command from the first commit.
- **MAX-10** · P2 · Contacts as a store rather than a five-minute cache: `last_messaged_at`,
  where a row came from, and the dialog partner persisted so "who did I last message" is a query
  (`src/cache/schema.ts:32`). Then `max contacts sync` with a request budget, and a bounded
  refresh at the start of a command that needs names (`NEED-81`).
  Plan: `docs_ai/plans/2026-09-20-contacts-and-paging.md`. Needs `MAX-7` merged first — same files.
- **MAX-8** · P3 · Telemetry as other clients send it — a later phase, and only once our own
  traffic is understood (`NEED-16`).
- **MAX-9** · P3 · The rest of the messenger surface, in the order of §35: attachments and
  reactions when reading, then uploads, reactions, edits and group administration when writing.
  Stories and calls last.

## The command

**`CLI-4` and `CLI-6` are closed.** The configuration file, the order a setting is decided in,
the profile as the first word, `--quiet` over the protocol note, and `--verbose` with the run log
are all built; `"record": true` and `keepRunsForDays` now reach `src/runs/recording.ts` through
`resolveSettings` (`src/commands/context.ts`). How it works is
[`ARCHITECTURE.md`](ARCHITECTURE.md) §13 and §14.

- **CLI-7** · P2 · The same paging parameters on every listing command — `--limit`, `--page`,
  `--all`, pushed into SQL rather than slicing — and `contacts list` ordered by who was last
  messaged (`NEED-81`). In machine mode a paged list answers `{items, page, limit, hasMore}`
  instead of an array (`NEED-86`), which moves `README.md`, `ARCHITECTURE.md` §10 and
  `scripts/verify-commands.ts` with it. Plan: `docs_ai/plans/2026-09-20-contacts-and-paging.md`
  §3.6–§3.7.
- **CLI-5** · P3 · The debug escape hatch — `max raw` / `max protocol invoke` — spec-validated,
  explicitly advanced, never arbitrary packet injection (§22).
- **CLI-6** · 🚩 P2 · The same paging parameters on every listing command — `--limit`, `--page`,
  `--all`, pushed into SQL rather than slicing — and `contacts list` ordered by who was last
  messaged (`NEED-81`). 🚩 on `NEED-86`: whether `--json` answers a paged list with an array or
  with an object carrying the page. Plan: `docs_ai/plans/2026-09-20-contacts-and-paging.md` §3.6.

## Risks carried

- **RISK-2** · P2 · A login per command may exhaust the session token. One reverse-engineering
  document reports a reset after ~30–50 logins "in a short interval" and defines neither the
  interval nor a symptom beyond "the connection closes right after INIT"; no other source mentions
  it. Proposal §11.1: persist the rotated token the login response returns, name the symptom in an
  error message, count logins — and do not refuse on a ceiling nobody has measured (`NEED-8`).

## Known unknowns

- **PROTO-1** · P2 · What opcode 36 actually returns. tsmax and PyMax call it `CONTACT_LIST`, the
  protocol documentation calls it `GET_BLOCKED`. Unused until somebody watches it.
- **PROTO-2** · P2 · How long MAX remembers a `cid`. The retry rule rests on deduplication measured
  seconds apart; a retry minutes later is unproven.
- **PROTO-3** · P3 · The upper bound on `chatsCount` in `LOGIN`. 100 works, 200 is refused as "out
  of range"; the boundary is somewhere between. The specification caps it at 100 meanwhile.
- **PROTO-6** · P3 · What `messages` in the `LOGIN` answer actually holds. Measured 2026-09-20: it
  is an **object**, not the array the specification declared, and nothing in the code reads it —
  `src/spec/operations/session.ts` now says `unknown` rather than guessing.
- **PROTO-5** · P3 · How long a message id can get, and whether a chat id ever crosses 2⁵³.
  Measured 2026-09-19 over 25 chats and 6 contacts: chat ids reach 14 digits, contact ids 9, none
  past 2⁵³. The login carried no messages that run, so the 18-digit message id remains a single
  earlier observation — and message ids are only ever read, never sent.
