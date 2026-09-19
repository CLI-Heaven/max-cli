# Backlog

Everything not yet built, one line per item. A closed item is **deleted** from here — the trail
stays in git history, and in `BACKLOG_DONE.md` once a first closed item starts that file.

The brief this is cut from: [`REQUIREMENTS.md`](REQUIREMENTS.md). The plan for the current
thread: `docs_ai/plans/` (local only, not committed).

**Working as of 2026-09-19**: seven commands — `login`, `me`, `chats`, `contacts`, `messages`,
`send`, `logout` — verified against the real MAX, and every request they send is built from the
specification in `src/spec/`. 78 tests. What each part does and why is
[`ARCHITECTURE.md`](ARCHITECTURE.md); what was ruled is [`DECISIONS.md`](DECISIONS.md).

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
regenerates and asserts the tree did not change. How to add an operation is
[`ARCHITECTURE.md`](ARCHITECTURE.md) §12; what was ruled is `NEED-7`, `NEED-34` and `NEED-35`.

**Still open from that phase:**

- **RES-5** · 🟡 P2 · Whether `LOGIN` itself moves presence or read state. Reading history does not
  (we never send `CHAT_MARK`, and a test asserts it), but the login flag `interactive` is
  unexplained by every source. Needs a second device watching.
- **DOC-1** · ✅ Closed — [`ARCHITECTURE.md`](ARCHITECTURE.md) exists and describes working code.

## Repository and tooling

- **OPS-4** · P3 · Publishing and releasing, once there is something worth installing.
- **OPS-9** · P3 · `scripts/probe.ts` does not run — the command in its own header fails on the
  first import, because Node's type stripping will not resolve a `.js` specifier to a `.ts` file.
  `scripts/id-shape.ts` shows the working shape: import from `dist/` and build first. It also
  calls opcode 16, which is an update, against a real account.
- **OPS-8** · P2 · Typecheck the test files. `tsconfig.json:24` excludes `src/**/*.test.ts`, so no
  test is ever checked — which is how `src/client.test.ts:177` came to compare against
  `Opcode.CHAT_MARK`, a constant that does not exist, and pass. A second `tsconfig.test.json` with
  `noEmit`; removing the exclude instead would emit tests into `dist`.

## The foundation

- **CORE-6** · P1 · Check `node:sqlite` on Node **22** — it may still need `--experimental-sqlite`
  there, and only Node 24 was measured. Before the cache phase, not before the slice (`NEED-11`).

- **CORE-5** · P2 · Move `braze-cli` onto the extracted `cli-core` rather than leaving it on its
  own copy — the whole point of extracting rather than copying. Another repository, so it is its
  own change, and it does not block anything here.

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
- **MAX-8** · P3 · Telemetry as other clients send it — a later phase, and only once our own
  traffic is understood (`NEED-16`).
- **MAX-9** · P3 · The rest of the messenger surface, in the order of §35: attachments and
  reactions when reading, then uploads, reactions, edits and group administration when writing.
  Stories and calls last.

## The command

- **CLI-4** · P2 · Profiles, `--verbose`, `--quiet`, configuration and its precedence order (§11,
  §13).
- **CLI-5** · P3 · The debug escape hatch — `max raw` / `max protocol invoke` — spec-validated,
  explicitly advanced, never arbitrary packet injection (§22).

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
- **PROTO-4** · P2 · Whether any real id on this account is past 2⁵³. Until the specification
  landed, `Number(chatId)` rounded every outgoing id, which for an id that long is a different
  chat. Repaired regardless; `pnpm probe:ids` says whether it was ever doing damage.
