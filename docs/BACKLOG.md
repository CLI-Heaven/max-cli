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

- **MAX-9** · 🟡 P2 · The rest of the messenger surface, in the order of REQUIREMENTS §35.
  Done: attachments, replies and forwards when reading (`src/domain/models.ts:23-75`). Left:
  reactions when reading (`MAX-15`, needs its own request), then uploads, sending reactions, edits; group administration
  last. Each writing operation needs its request shape measured first.
- **MAX-14** · 🚧 `attachment-download` · P2 · Download an attachment: `messages download <chat> <id> [--output <dir>]`. A photo
  link opens without a cookie or a token (`src/domain/models.ts:26-29`); files are not measured yet.
- **RES-8** · P2 · Does `MSG_SEND` take a reply and markup? `elements` is always sent empty
  (`src/spec/operations/messages.ts:19`); its meaning is a guess from the name. Needs a frame from
  the real web client sending a reply and bold text — the owner captures it in the browser's
  network tab. Unblocks `--reply-to` and markup.
- **CLI-19** · 🚧 `config-set` · P3 · `config set|unset <key> [value]`, and defaults shared by every profile. Today the
  file is edited by hand and settings exist only per profile (`src/config.ts:35`).
- **MAX-4** · 🟡 P3 · Chat addressing. Done: an id, or a title matched exactly then as a fragment,
  an ambiguous one refused (`src/client.ts:149`). Left: `@username`, a phone number, a chat the
  account is not in.
- **CLI-5** · P3 · `max raw <operation>` — a debug escape hatch, validated against the spec, never
  arbitrary frames (REQUIREMENTS §22).
- **MAX-8** · P3 · Telemetry as the official client sends it — only once our own traffic is
  understood (`NEED-16`).

## Research and protocol unknowns

- **MAX-15** · P3 · Show reactions when reading. History does not carry them: after the owner
  reacted in Saved messages, 653 messages from 25 chats (Saved included) had no reaction field
  (`pnpm probe:reactions`, 2026-09-23). Next: find the request that reads reactions in the other
  clients' current source, then measure it read-only. Never try a number blind — it may be the one
  that adds a reaction. Correction: an earlier line here took `reactionInfo` from test data.
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

- **CORE-5** · ⏸️ P3 · Move `braze-cli` onto `@leemour/cli-core` instead of its own copy. Deferred by
  the owner.
- **RISK-2** · P3 · A login per command may exhaust the session. One source claims a reset after
  30–50 logins; 65 on the real account broke nothing (2026-09-21). `max doctor` shows the count.
