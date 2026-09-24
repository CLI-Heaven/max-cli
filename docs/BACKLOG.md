# Backlog

Open work only, one item per line. Closed items move to [`BACKLOG_DONE.md`](BACKLOG_DONE.md).
What the tool does today: [`commands.md`](commands.md) (generated). How it is built:
[`ARCHITECTURE.md`](ARCHITECTURE.md). What the owner ruled: [`DECISIONS.md`](DECISIONS.md).

## Rules

- **An id is permanent** and never reused. Next free one:
  `grep -ohE '<PREFIX>-[0-9]+' docs/BACKLOG*.md | sort -V | tail -1`.
- **Prefixes:** `RES` research and measurement · `OPS` repository, tooling, CI, release · `CORE`
  `cli-core` · `SPEC` protocol spec and generator · `MAX` domain, client, transport, session ·
  `CLI` commands and output · `DOC` handwritten docs · `PROTO` protocol unknowns · `RISK` risks.
- **One item:** the task as a title, then where the work starts (`path:line` or a REQUIREMENTS §).
  Analysis goes to a plan in `docs_ai/plans/`, a ruling to `DECISIONS.md`.
- **Priority:** **P1** blocks work or breaks something real · **P2** this cycle · **P3** someday.
- **Mark:** none — not started · 🚧 `<branch>` — taken · 🟡 — half done, the rest named ·
  ⏸️ — deferred by the owner · 🚩 — waits on an owner decision.
- **Claim before code:** put `🚧 <branch>` on the line in the first push of the branch. Two agents
  built the same command on 2026-09-23 because an open PR was the only signal.
- **Close in the PR that ships the work:** move the line to `BACKLOG_DONE.md` in the same PR.

## Features

- **CLI-22** · P2 · Scheduled send: `max messages send <chat> <text> --at <time>`. MAX schedules
  messages itself, and the official web client does it with `MSG_SEND` (64) carrying
  `message.delayedAttributes.timeToFire` in milliseconds (web.max.ru source, read 2026-09-24,
  `FIND-78`), so the message leaves even with this machine off. Plan:
  `docs_ai/plans/2026-09-24-latest-and-scheduled.md`. Builds on `MSG_SEND` as #56 leaves it.
  Correction 2026-09-24: this line first asked whether MAX can schedule at all, with the OS
  scheduler as the fallback. It can.
- **CLI-23** · P2 · Check the latest messages across all chats in one command, readable by default
  and `--json` for scripts. `messages list` reads one chat only (`docs/commands.md`,
  `max messages list`). Remembers the last check in the profile on its own, so a scheduled run
  shows only what is new; `--since <time>` overrides it for a one-off look (`NEED-162`). Must not mark anything read (REQUIREMENTS §19). The one
  feature both target users need (`NEED-143`).
- **MAX-9** · 🟡 P2 · The rest of the messenger surface, in the order of REQUIREMENTS §35.
  Done: attachments, replies and forwards when reading (`src/domain/models.ts:23-75`); sending a
  reaction (`max reactions add`, `NEED-141`). Left: uploads, edits; group administration
  last. Each writing operation needs its request shape measured first.
- **MAX-4** · 🟡 P3 · Chat addressing. Done: an id, or a title matched exactly then as a fragment,
  an ambiguous one refused (`src/client.ts:149`). Left: `@username`, a phone number, a chat the
  account is not in.
- **CLI-5** · P3 · `max raw <operation>` — a debug escape hatch, validated against the spec, never
  arbitrary frames (REQUIREMENTS §22).
- **MAX-8** · P3 · Telemetry as the official client sends it — only once our own traffic is
  understood (`NEED-16`).

- **RES-5** · 🟡 P2 · Does `LOGIN` move presence or read state? Reading history does not (no
  `CHAT_MARK`, tested). The login flag `interactive` is unexplained (`ARCHITECTURE.md` §4). Needs a
  second device watching.
- **RES-7** · P3 · What a real client sends as opcode 36's payload. `{}`, `{marker}` are refused and
  `{marker, count}` closes the connection (`pnpm probe:contacts`), so only a capture answers it. It
  is the only route to contacts who share no chat. Closes `PROTO-1`.
- **PROTO-1** · 🟡 P3 · What opcode 36 returns: other clients call it `CONTACT_LIST`, the protocol
  notes call it `GET_BLOCKED`. Waits on `RES-7`.
- **PROTO-2** · P2 · How long MAX remembers a `cid`. The send retry rests on deduplication measured
  seconds apart; minutes apart is unproven (`ARCHITECTURE.md` §6).
- **PROTO-3** · P3 · The upper bound on `chatsCount` in `LOGIN`: 100 works, 200 is refused. The spec
  caps it at 100 (`src/spec/operations/session.ts:52`).
- **PROTO-5** · P3 · Whether any id passes 2⁵³. Chat ids reach 14 digits, contact ids 9; ids are
  strings everywhere, so only a number crossing the boundary in arithmetic would break.
- **PROTO-6** · P3 · What the `messages` object in the `LOGIN` answer holds. Nothing reads it
  (`src/spec/operations/session.ts:89`); `pnpm probe:ids` prints its type and key count.
- **SPEC-3** · P3 · Sanitized protocol fixtures under `fixtures/protocol/`, synthetic values only
  (REQUIREMENTS §24). Response shapes are already tested with made-up payloads in `src/spec/`.
- **SPEC-4** · P3 · A generated list of implemented operations (§8, §30). Deferred: listing what MAX
  has and we lack means maintaining MAX's whole surface (§10).

## Foundation and risks

- **CORE-9** · P2 · Self-update: `max update` finds how `max` was installed (npm, pnpm or bun,
  globally) and runs that package manager, plus a once-a-day "a newer version exists" line — on
  stderr, in pretty mode only, never where an agent reads JSON. Shared in `cli-core`; the idea is
  oclif's `plugin-update`.
- **CORE-10** · P3 · Plugins from npm, **only from an allow-list** kept in the CLI itself — package
  names with pinned versions and integrity hashes — never an arbitrary package: a plugin runs inside
  a program holding the token of a personal account. oclif's `plugin-plugins` is the model.
- **CORE-11** · P3 · Installers and standalone archives per platform (oclif's `pack`), after a
  single-file build (G4 §3.9: Bun only). Lowest priority.
- **CORE-5** · ⏸️ P3 · Move `braze-cli` onto `@leemour/cli-core` instead of its own copy. Deferred by
  the owner.
- **RISK-2** · P3 · A login per command may exhaust the session. One source claims a reset after
  30–50 logins; 65 on the real account broke nothing (2026-09-21). `max doctor` shows the count.

## Later — each reopens a ruling

Added by the owner on 2026-09-24. Each one goes against REQUIREMENTS §3 or §18, and the line says
which; the plan for it starts by saying so.

- **MAX-16** · P3 · A watching server: one long-running process that keeps the connection open and
  hands new messages to other tools as they arrive. Reopens REQUIREMENTS §3 and §18 (one command,
  one operation, no daemon) and §34 (traffic like the official client's). A separate package beside
  the CLI, not a mode of it (`NEED-137`). Unlocks what a scheduled run cannot do: a reply within
  seconds, a trigger on an incoming message.
- **CLI-24** · P3 · Voice messages to text with a local speech model (Whisper, Parakeet or
  similar), downloaded on first use and never bundled. Builds on `max messages download`.
  The model runs on this machine; audio never leaves it.
- **CLI-25** · P3 · `max bot …` — work with a MAX bot through the official bot API and a bot token,
  beside the personal account. Reopens REQUIREMENTS §3 ("not a bot-account client"). Bots are
  issued only to verified organisations, sole traders and the self-employed
  ([dev.max.ru](https://dev.max.ru/docs/maxbusiness/connection)).
