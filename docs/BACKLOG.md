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

## Repository and tooling

- **OPS-4** · ✅ Closed 2026-09-21 — `@leemour/max-cli@0.1.0` is on npm and installs: `npm i
  @leemour/max-cli` then `max --version` answers `0.1.0`, verified from a directory outside the
  repository. `@leemour/cli-core@0.1.0` went first, because the dependency had to exist before
  anything could install. Both packages published under the previous scope were deleted the same
  day (`NEED-111`). How a release is made: [`releasing.md`](releasing.md).
- **OPS-10** · ✅ Closed 2026-09-20 — [`commands.md`](commands.md) is written by
  `scripts/commands.ts` from the command tree, on every `pnpm generate`. It needed no new CI step:
  the staleness check that already guarded [`protocol.md`](protocol.md) guards it too, and the
  suite compares the committed page with what the generator produces right now.
- **OPS-9** · **closed 2026-09-22 by deletion, not by repair.** `scripts/probe.ts` never ran: its
  own header fails on the first import, it was wired to no `pnpm` script, and it sent opcode 16 —
  an **update** — to a real account. Everything it asked is answered by `probe:ids`,
  `probe:contacts` and `probe:token`, which import from `dist/`, take the token from the keyring
  rather than the environment, and read only. A probe nobody can run is not a probe.

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

- **CLI-5** · P3 · The debug escape hatch — `max raw` / `max protocol invoke` — spec-validated,
  explicitly advanced, never arbitrary packet injection (§22).

## Risks carried

- **RISK-2** · P2 · A login per command may exhaust the session token. One reverse-engineering
  document reports a reset after ~30–50 logins "in a short interval" and defines neither the
  interval nor a symptom beyond "the connection closes right after INIT"; no other source mentions
  it. Proposal §11.1: persist the rotated token the login response returns, name the symptom in an
  error message, count logins — and do not refuse on a ceiling nobody has measured (`NEED-8`).

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
  `src/spec/operations/session.ts` now says `unknown` rather than guessing.
- **PROTO-5** · P3 · How long a message id can get, and whether a chat id ever crosses 2⁵³.
  Measured 2026-09-19 over 25 chats and 6 contacts: chat ids reach 14 digits, contact ids 9, none
  past 2⁵³. The login carried no messages that run, so the 18-digit message id remains a single
  earlier observation — and message ids are only ever read, never sent.
