# Backlog

Everything not yet built, one line per item. A closed item is **deleted** from here — the trail
stays in git history, and in `BACKLOG_DONE.md` once a first closed item starts that file.

The brief this is cut from: [`REQUIREMENTS.md`](REQUIREMENTS.md). The plan for the current
thread: `docs_ai/plans/` (local only, not committed).

**Nothing is built yet.** The repository holds these documents and nothing else. The list below is
therefore cut from the brief rather than from code, and every anchor is a section of it; anchors
become `path:line` as soon as there is a path.

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

## Blocking everything: the architecture proposal

The brief's first deliverable (§31). **Written 2026-09-19 and awaiting approval** —
`docs_ai/plans/2026-09-19-architecture.md` (local only). Until it is accepted, every item below it
is an estimate of work whose shape is not yet known.

- **RES-1** · 🟡 P1 · The file-by-file inventory of what moves to `cli-core` — answered in the
  proposal's §4. Reopens only if the proposal is rejected.
- **RES-2** · 🟡 P1 · Which MAX client or transport — answered in the proposal's §2: our own
  WebSocket adapter, because `@bruch/max-client` is Bun-coupled in four places and the WebSocket
  path is plain JSON.
- **RES-3** · 🟡 P1 · TypeSpec proof of concept — built, compiles and emits (proposal §7), which
  still recommends a TypeScript module instead. Waiting on `NEED-7`.
- **RES-4** · P2 · Survey how the CLIs that agents actually drive are built — `wrangler`, `gh`,
  `stripe` — and keep only what changes a decision here. Not done: outside §31's list, and not a
  document of its own — each item lands as a backlog line or is dropped.
- **RES-5** · 🟡 P1 · Whether reading history marks messages read — half answered in the proposal's
  §11.4: marking is a separate opcode we simply never send, but whether `LOGIN` itself moves
  presence or read state needs a live check from a second device.
- **DOC-1** · P1 · Write `ARCHITECTURE.md` once the proposal is accepted — the seams, the
  lifecycle, what is generated and what is not. Not before: an architecture document written
  ahead of the architecture is fiction.

## Repository and tooling

- **OPS-1** · P3 · Settle the npm scope at the first publish — `@cli-heaven/max-cli` is the
  obvious one. Everything else about the naming is ruled: package `max-cli`, command `max`,
  repository [`CLI-Heaven/max-cli`](https://github.com/CLI-Heaven/max-cli) (`NEED-1`, `NEED-4`).
- **OPS-2** · P1 · Scaffold the workspace: pnpm, TypeScript strict, Biome, Vitest, lefthook, a CI
  workflow that runs lint, typecheck and tests on every pull request — copied from `braze-cli`,
  not reinvented (§1).
- **OPS-3** · P2 · A `generate` script plus a CI check that fails when generated output is stale —
  regenerate, then assert the working tree did not change (§8).
- **OPS-4** · P3 · Publishing and releasing, once there is something worth installing.

## The foundation

- **CORE-1** · P1 · Extract `cli-core` out of `braze-cli` **now**, into
  [`CLI-Heaven/cli-core`](https://github.com/CLI-Heaven/cli-core), which exists and is empty
  (`NEED-3`). The inventory of what moves comes from RES-1; §26's "copy now, extract later" route
  is closed.
- **CORE-4** · P1 · Consume `cli-core` from both CLIs and keep them on one version: it has to
  reach a registry or be pinned some other way, because two repositories cannot share a private
  workspace package (`NEED-3`). Decide the mechanism with OPS-1's scope answer.
- **CORE-5** · P2 · Move `braze-cli` onto the extracted `cli-core` rather than leaving it on its
  own copy — the whole point of extracting rather than copying. Another repository, so it is its
  own change, and it does not block anything here.
- **CORE-2** · P2 · Keep the credential abstraction generic: keyring first, file fallback, the
  injected seam that makes it impossible for a test to reach a real keychain (§13).
- **CORE-3** · P2 · Retry, backoff and jitter as primitives with no default opinion about whether
  an operation may be retried — the caller decides, because a resend is not a re-read (§17).

## The protocol

- **SPEC-1** · P1 · The v1 specification: authentication, current user, chat list, message
  history, send text, logout — and nothing else (§11). Every operation carries where its shape
  came from and how confident we are (§10).
- **SPEC-2** · P1 · The generator: spec → normalized model → deterministic emitters for types,
  validators, an operation registry and typed client methods. Generated files are marked, are
  committed, and are never hand-edited (§8, §28).
- **SPEC-3** · P2 · Sanitized protocol fixtures under `fixtures/protocol/`, synthetic values only
  — never a real phone number, token, chat id or message (§24).
- **SPEC-4** · P3 · A generated coverage document: which documented operations are implemented
  (§8, §30).

## MAX

- **MAX-1** · P1 · Our own `MaxClient` interface — authenticate, getMe, listChats, listMessages,
  sendMessage, close — and one adapter behind it. No third-party type reaches anything above it
  (§25).
- **MAX-2** · P1 · Session persistence: what the chosen client needs, stored under the user state
  directory with restrictive permissions, never printed, never committed, redacted in logs (§13).
- **MAX-3** · P1 · Domain models for chat and message, and the mapping from the wire shape onto
  them — tolerant of unknown fields when reading, strict when sending (§16, §29).
- **MAX-4** · P2 · Chat addressing that can grow a resolver later without changing the command
  surface (§12).

## The command

- **CLI-1** · P1 · The vertical slice: `login`, `me`, `chats`, `messages`, `send`, `logout`, each
  with human output and `--json` (§32).
- **CLI-2** · P1 · The machine-output invariant, with a test: in `--json` mode stdout carries one
  JSON value and nothing else, diagnostics go to stderr (§3, §15).
- **CLI-3** · P1 · Lifecycle: every command closes its transport on every exit path, and a test
  that fails when the process stays alive (§18, §23.10).
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
