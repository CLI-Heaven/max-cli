# Backlog

Open work only, one item per line. Closed items move to [`BACKLOG_DONE.md`](BACKLOG_DONE.md).
What the tool does today: [`commands.md`](commands.md) (generated). How it is built:
[`ARCHITECTURE.md`](ARCHITECTURE.md). What the owner ruled: [`DECISIONS.md`](DECISIONS.md).

## Rules

- **An id is permanent** and never reused. Take one with `bin/next-id <PREFIX>`: one counter for
  every worktree on the machine, under a lock, and never below the highest number on any branch.
  Searching the text instead gave out `CLI-26` three times and `MAX-16` and `MAX-23` twice on
  2026-09-24.
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

**From the PyMax comparison (2026-09-24, `NEED-175`).** Each is what PyMax's source declares
(`MaxApiTeam/PyMax`, `src/pymax/api/`, commit `53103f0`) — a claim until measured. Every writing
operation is measured first in Saved messages (chat 0), as replies and reactions were (`NEED-150`),
and needs the owner's yes before it ships. Deleting messages and marking them read stay ruled out
(`NEED-32`, REQUIREMENTS §19).

- **MAX-23** · 🟡 🚧 `send-media` · P1 · Send photos, videos and files. Done: `--file` sends photos
  (several in one message) and files (one per message, measured 2026-09-24). Left: a video as a
  video, not as a file (`upload_video`, opcode 82 with `type: 1`).
- **MAX-24** · 🚩 P1 · Send a voice message. The upload works (opcode 82, `uploaderType: 1` for
  .ogg); the message does not: the web client sends `{_type: "AUDIO", audioId, duration, wave, token}`
  with `wave` as 80 raw bytes in a binary MessagePack frame, and none of six JSON forms was accepted
  (`FIND-104`). Waits on `MAX-40`.
- **MAX-25** · P1 · Edit your own message (`edit_message`, `MSG_EDIT` 67). It changes a message the
  other person may have read already.
- **MAX-26** · P1 · Forward a message to another chat (`forward_message`; tsmax sends `MSG_SEND` with
  `link: {type: "FORWARD", messageId, chatId}`).
- **MAX-27** · P1 · Pin and unpin a message (`pin_message`).
- **MAX-28** · P1 · Polls: show them when reading, and vote (`vote_poll`).
- **MAX-29** · P1 · Remove your reaction (`remove_reaction`, `MSG_CANCEL_REACTION` 179). Pairs with
  `max reactions add`.
- **MAX-30** · P1 · Groups and channels you belong to: create a group, join or leave a group or a
  channel by link, invite and remove members (`create_group`, `join_group`, `join_channel`,
  `leave_group`, `leave_channel`, `invite_users_to_group`, `invite_users_to_channel`,
  `remove_users_from_group`, `resolve_group_by_link`).
- **MAX-31** · P1 · Administer a group: admins, name and settings, join requests, the invite link
  (`add_admin`, `change_group_profile`, `change_group_settings`, `get_join_requests`,
  `confirm_join_request(s)`, `decline_join_request(s)`, `rework_invite_link`). Deleting a chat
  (`delete_chat`) is not included — the same reasoning as `NEED-32`.
- **MAX-32** · P1 · Contacts: add, remove, import, find a person by phone number (`add_contact`,
  `remove_contact`, `import_contacts`, `search_by_phone`). A phone number never reaches a log.
- **MAX-33** · P1 · Your own account: edit the profile, manage chat folders, list your other
  sessions and end them (`change_profile`, `get_folders`, `create_folder`, `update_folder`,
  `delete_folder`, `get_sessions`, `close_all_sessions`). Ending sessions must never end this one
  — `LOGOUT` (20) stays never-sent.
- **MAX-40** · P3 · Speak the official web client's binary protocol: frames with version 10, a
  binary header and a MessagePack payload, instead of our JSON text frames (version 11,
  `src/protocol/frame.ts`). Read in the web.max.ru bundle 2026-09-24 (`nre()` in its socket code).
  MAX can tell our frames from the web client's today (`REQUIREMENTS.md` §34), and voice messages
  (`MAX-24`) need a byte field JSON cannot carry. Start with a read-only probe: log in and list chats
  over binary frames. Ranked P3 by the owner 2026-09-24.
- **MAX-34** · P3 · Live events: a long-running `max listen` that prints new messages, edits,
  reactions and typing as they arrive (PyMax's `on_message`, `on_message_edit`,
  `on_reaction_update`…). Conflicts with one-shot commands (`CLAUDE.md` constraint 4), so it needs
  a ruling first. What is new since the last check is already `max inbox` (`CLI-23`).

- **MAX-4** · 🟡 P3 · Chat addressing. Done: an id, or a title matched exactly then as a fragment,
  an ambiguous one refused (`src/client.ts:149`). Left: `@username`, a phone number, a chat the
  account is not in.
- **CLI-5** · P3 · `max raw <operation>` — a debug escape hatch, validated against the spec, never
  arbitrary frames (REQUIREMENTS §22).
- **MAX-8** · P1 · Look like the official client beyond the user agent: the telemetry it sends and
  the device details it reports (`NEED-16`). PyMax does both (`src/pymax/telemetry/`,
  `src/pymax/fingerprint/`). Raised from P3 by the owner 2026-09-24 (`NEED-175`).

- **CLI-28** · P3 · MCP: confirm a send with a form from the server itself (elicitation, `inputRequired`
  in SDK v2) showing the recipient and the text; refuse where the client cannot show one. Waits for
  a check of which clients support it (`NEED-151` B, `docs_ai/plans/2026-09-23-mcp-server.md`).

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

- **MAX-38** · P2 · When MAX answers a login with its rate limit, stop and remember it: its own exit
  code and message, and a cool-down in the profile state so the next run refuses locally instead of
  logging in again. Nothing retries a login today, but a scheduled `max inbox --new` logs in on
  every run, and in PyMax a login retried after the limit error kept the account locked out
  ([#106](https://github.com/MaxApiTeam/PyMax/issues/106), open since 2026-09-14). Research: G1 §3.11.
- **MAX-39** · P2 · Notice when the client version we present goes stale. `appVersion` is fixed at
  `26.5.5` (`src/spec/identity.ts:20`); PyMax broke when MAX began refusing an old one
  ([#86](https://github.com/MaxApiTeam/PyMax/issues/86)). A probe reads the version web.max.ru
  currently sends, and `max doctor` says when ours is behind. Research: G1 §3.15.
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

- **MAX-35** · P3 · A watching server: one long-running process that keeps the connection open and
  hands new messages to other tools as they arrive. Reopens REQUIREMENTS §3 and §18 (one command,
  one operation, no daemon) and §34 (traffic like the official client's). A separate package beside
  the CLI, not a mode of it (`NEED-137`). Unlocks what a scheduled run cannot do: a reply within
  seconds, a trigger on an incoming message.
  Correction 2026-09-24: numbered `MAX-16` until then, which `qr-login` had claimed on 2026-09-23.
- **CLI-24** · P3 · Voice messages to text with a local speech model (Whisper, Parakeet or
  similar), downloaded on first use and never bundled. Builds on `max messages download`.
  The model runs on this machine; audio never leaves it.
- **CLI-25** · P3 · `max bot …` — work with a MAX bot through the official bot API and a bot token,
  beside the personal account. Reopens REQUIREMENTS §3 ("not a bot-account client"). Bots are
  issued only to verified organisations, sole traders and the self-employed
  ([dev.max.ru](https://dev.max.ru/docs/maxbusiness/connection)).
- **CLI-27** · P3 · Hooks for workflows: `max` runs a configured command when a check finds
  something new. Asked by the owner 2026-09-24 (`NEED-172`). Two things to settle in the plan: the
  message text reaches that command, so it must go as data on stdin and never into the command
  line; and without a watching process (`MAX-35`) a hook fires only when `max` runs, so it is
  `max inbox --new` on a schedule with a pipe in the end — say what it adds over that.
