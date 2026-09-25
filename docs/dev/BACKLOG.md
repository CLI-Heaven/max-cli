# Backlog

Open work only, one item per line. Closed items move to `docs_ai/BACKLOG_DONE.md`.
What the tool does today: [`../commands.md`](../commands.md) (generated). How it is built:
[`ARCHITECTURE.md`](ARCHITECTURE.md). What the owner ruled: `docs_ai/DECISIONS.md`.

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
- **Close in the PR that ships the work:** delete the line here in that PR, and append it to
  `docs_ai/BACKLOG_DONE.md` (local, not in git). Users read what shipped in `CHANGELOG.md`.

## Features

- **CLI-34** · P2 · `max backup messages <chat> --since <date> | --last
  <n>`: without `--run` only the estimate (what the cache holds, what is missing, requests and
  minutes); with `--run` it fills the gaps within limits and stops on any error. One chat per call
  (`NEED-217`). Defaults measured on web.max.ru 2026-09-25 (`RES-9`): 30 messages back per page,
  `forward: 0`, the next page starts at the time of the oldest message loaded (it comes back again),
  a page shorter than 30 is the start of the chat; the web client sets no pause of its own.
  Plan: `docs_ai/plans/2026-09-24-history-backup.md`.
**From the PyMax comparison (2026-09-24, `NEED-175`).** Each is what PyMax's source declares
(`MaxApiTeam/PyMax`, `src/pymax/api/`, commit `53103f0`) — a claim until measured. Every writing
operation is measured first in Saved messages (chat 0), as replies and reactions were (`NEED-150`),
and needs the owner's yes before it ships. Deleting messages was ruled out (`NEED-32`) until the owner asked for it on 2026-09-24 (`MAX-47`); marking
read only on an explicit flag (`CLI-33`, REQUIREMENTS §19).

- **MAX-23** · 🟡 P1 · Send photos, videos and files. Done: `--file` sends photos
  (several in one message) and files (one per message, measured 2026-09-24). Left: a video as a
  video, not as a file: opcode 82 with `type: 0`, POST, wait for push 136, then `_type: "VIDEO"`
  with `videoType: 0` (PyMax 2.4.1 `upload_video`, code; a user reports it works, PyMax #94).
  Correction 2026-09-24: this line said `type: 1`, which is a round video note (`MAX-48`).
- **MAX-24** · P1 · Send a voice message. The upload works (opcode 82, `uploaderType: 1` for
  .ogg); the message does not: the web client sends `{_type: "AUDIO", audioId, duration, wave, token}`
  with `wave` as 80 raw bytes in a binary MessagePack frame, and none of six JSON forms was accepted
  (`FIND-104`). Unblocked: frames are binary since `MAX-40`, and a `Uint8Array` in a payload goes out
  as MessagePack bin.
- **MAX-28** · P2 · Polls: show them when reading, vote (`SEND_VOTE` 304
  `{chatId, messageId, pollId, answersIds}`), create one (a `_type: "POLL"` attachment on `MSG_SEND`
  64, `settings` 2 multiple | 4 revote). **Creating one works over the binary protocol** — accepted
  and deleted in Saved messages by `pnpm smoke:live`, 2026-09-25; over JSON it was refused with
  `proto.payload`, most likely the float64 of `FIND-163`. Reopened by the owner 2026-09-25 (`NEED-261`)
  after the ⏸️ of the same morning. web.max.ru still does not display polls («Обновите MAX…»), so
  say in the output that recipients on the web will not see it. Branch `feat/max-28-polls` is on
  the old JSON protocol: start again from `main`, take its parser and command.
- **MAX-48** · P3 · Send a round video note ("кружок"): opcode 82 `{type: 1, uploaderType: 1}`,
  `thumbhash` from the upload answer, `_type: "VIDEO"` with `videoType: 1`. MAX refuses a file that
  is not 480×480, `yuv420p`, limited range, bt709, baseline, AAC 48 kHz mono (PyMax #94). `thumbhash`
  is bytes — a `Uint8Array` in a payload goes out as MessagePack bin since `MAX-40`.
- **MAX-49** · P3 · Two-step password: log in when MAX asks for it (`passwordChallenge` in the login
  answer, then `AUTH_LOGIN_CHECK_PASSWORD` 115 `{trackId, password}`), and set or remove one
  (112 → 107 → 111). PyMax 2.4.1, code; a user logged in with it on the mobile client (PyMax #106).
  The password is typed at a prompt, never an argument.
- **MAX-41** · 🟡 P2 · Measure opcode 77 (`CHAT_MEMBERS_UPDATE`). Done 2026-09-24 with a second
  person (`pnpm probe:members`): add, remove, make admin, take admin back. Left: accept and decline a
  join request — needs somebody who asks to join a group the owner runs.
- **MAX-42** · P2 · Profile and contacts, what `MAX-32`/`MAX-33` left out: a profile photo
  (`PHOTO_UPLOAD` 80 with `profile: true`, then `photoToken` and `avatarType: "USER_AVATAR"` in
  `PROFILE` 16 — web.max.ru `Q8r`), the short name (`link` in 16), a name of your own for a contact
  and blocking (`CONTACT_UPDATE` 34 with `UPDATE`, `BLOCK`, `UNBLOCK` — web.max.ru). Code, not measured.
- **MAX-45** · P2 · Real migrations for the cache instead of "drop and refill". `MAX-44` keeps
  `messages` and `ranges` by copying shared columns; any change beyond adding a nullable column
  (a rename, a type change, a split table) still has no path. Owner, 2026-09-24: migrations, maybe
  with an ORM such as Drizzle. Its docs describe both drivers we use, `drizzle-orm/node-sqlite` and
  `drizzle-orm/bun-sqlite`, and a runtime `migrate()` over generated SQL files — not tried here.
  The plan weighs it against the smaller option: numbered `.sql` files and a ~30-line runner on
  the `user_version` we already keep. Either way: the FTS5 tables and triggers are hand-written
  SQL, and the migration files have to ship inside the npm package. Starts at `src/cache/schema.ts`.
- **MAX-51** · 🚧 `max-51-chats-sync` · P2 · The `chatsSync` marker, as the tab uses it. Captured 2026-09-25
  (`docs/dev/capture/2026-09-25-web-tab.md`): a fresh tab sends `chatsSync: 0`; only a re-login on the
  same page sends a marker, and that marker is **not** the previous login's time — that goes in a new
  field, `lastLogin`, beside `configHash`. So: `0` on a fresh connection (every one-shot command,
  and `max serve`'s first login), a marker only when `max serve` logs in again. What the marker is
  remains open: have the recorder keep the LOGIN answer's `time` and `chatMarker` (as `t0+N`) and
  match them in the next capture. Over JSON the stored marker went in all four fields and MAX
  answered only changed chats; the refusal after `MAX-40` was a float64, not the field (`FIND-163`).
- **MAX-34** · 🚧 `max-34-watch-events` · P3 · Live events: a long-running `max listen` that prints new messages, edits,
  reactions and typing as they arrive (PyMax's `on_message`, `on_message_edit`,
  `on_reaction_update`…). Conflicts with one-shot commands (`CLAUDE.md` constraint 4), so it needs
  a ruling first. What is new since the last check is already `max inbox` (`CLI-23`).
  Correction 2026-09-25: the long-running part exists. `max serve` holds the connection and `max
  watch` prints new messages as they arrive (`src/server/server.ts`, `#pushed`). What is left is
  edits, reactions and typing. The server receives them but passes on only new messages (opcode 128).

- **MAX-4** · 🟡 P3 · Chat addressing. Done: an id, or a title matched exactly then as a fragment,
  an ambiguous one refused (`src/client.ts:149`). Left: `@username`, a phone number, a chat the
  account is not in.
- **CLI-36** · P3 · The local copy made optional: a setting under which `max` writes no chats or
  messages to disk and answers everything from MAX (`--offline` and `messages search` then refuse).
  Owner, 2026-09-24: «я бы сделал хранение опциональным в P3». Starts at `openProfileCache`
  (`src/commands/chats.ts:22` and every command that opens it).
- **CLI-5** · P3 · `max raw <operation>` — a debug escape hatch, validated against the spec, never
  arbitrary frames (REQUIREMENTS §22).
- **MAX-52** · 🚧 `max-52-serve-reads` · P2 · The requests a real tab sends right after LOGIN: 21 on a fresh start
  (`48 48 272 35 32 302 163 208 27×4 209 28 22 48 28 35 53 209 35`) and 9 after a re-login. `max`
  sends none, which shows on every login — a stronger difference than telemetry. Decide per
  request: the read-only ones (272 folders, 302 banners, 163 call history, 27) could be copied; 22
  subscribes to push and changes state. Captured 2026-09-25, `docs/dev/capture/2026-09-25-web-tab.md`.
  Names by PyMax (53103f0): 22 `CONFIG`, 27 `ASSETS_UPDATE`, 28 `ASSETS_GET_BY_IDS`, 32
  `CONTACT_INFO`, 35 `CONTACT_PRESENCE`, 48 `CHAT_INFO`, 53 `CHATS_LIST`, 208/209 stories, 272
  `FOLDERS_GET`, 302 `BANNERS_GET`; 163 is not in its list. Only `max serve` will send them.

- **RES-5** · 🟡 P2 · Does `LOGIN` move presence or read state? Reading history does not (no
  `CHAT_MARK`, tested). Partly answered by the capture of 2026-09-25: the tab's own LOGIN sends
  `interactive: false` too; `true` goes only in pings, while its window has focus. Left: whether
  opening a chat with unread messages marks it read without opcode 50 — see `RES-10`.
  Correction 2026-09-25 (`RES-10`, captured): the tab marks a chat read with an explicit opcode 50
  after opening it, not with 49. Left: confirm that 49 alone moves nothing — `RES-11`.
- **RES-11** · P3 · Drop `interactive: false` from our history request (49): the web client sends
  5 fields and never it, and marks a chat read with an explicit `CHAT_MARK` 50 after opening it, not
  with 49 (captured 2026-09-25, `docs_ai/captures/2026-09-25-res-10.jsonl`). One check first:
  `max messages list` on a chat with unread messages, without the field, and see that `unread`
  does not move.
- **RES-7** · P3 · What a real client sends as opcode 36's payload. `{}`, `{marker}` are refused and
  `{marker, count}` closes the connection (`pnpm probe:contacts`), so only a capture answers it. It
  is the only route to contacts who share no chat. Closes `PROTO-1`.
- **PROTO-1** · 🟡 P3 · What opcode 36 returns: other clients call it `CONTACT_LIST`, the protocol
  notes call it `GET_BLOCKED`. Waits on `RES-7`.
- **PROTO-2** · P2 · How long MAX remembers a `cid`. The send retry rests on deduplication measured
  seconds apart; minutes apart is unproven (`ARCHITECTURE.md` §6).
- **PROTO-3** · P3 · The upper bound on `chatsCount` in `LOGIN`: 100 works, 200 is refused. The spec
  caps it at 100 (`src/spec/operations/session.ts:52`).
- **PROTO-6** · P3 · What the `messages` object in the `LOGIN` answer holds. Nothing reads it
  (`src/spec/operations/session.ts:89`); `pnpm probe:ids` prints its type and key count.
- **SPEC-3** · 🟡 P3 · Sanitized protocol fixtures, synthetic values only (REQUIREMENTS §24). Done:
  the web client's frames, headers and payload structure without values
  (`src/testing/fixtures/web-capture-2026-09-25.json`, `MAX-40`), and the recorder for more
  (`scripts/capture/web-recorder.js`). Left: fixtures of MAX's answers to our own operations —
  response shapes are still tested with made-up payloads in `src/spec/`.
- **SPEC-4** · P3 · A generated list of implemented operations (§8, §30). Deferred: listing what MAX
  has and we lack means maintaining MAX's whole surface (§10).

## Foundation and risks

- **MAX-38** · P2 · When MAX answers a login with its rate limit, stop and remember it: its own exit
  code and message, and a cool-down in the profile state so the next run refuses locally instead of
  logging in again. Nothing retries a login today, but a scheduled `max inbox --new` logs in on
  every run, and in PyMax a login retried after the limit error kept the account locked out
  ([#106](https://github.com/MaxApiTeam/PyMax/issues/106), open since 2026-09-14). Research: G1 §3.11.
- **CORE-10** · P3 · Plugins from npm, **only from an allow-list** kept in the CLI itself — package
  names with pinned versions and integrity hashes — never an arbitrary package: a plugin runs inside
  a program holding the token of a personal account. oclif's `plugin-plugins` is the model.
- **CORE-11** · P3 · Installers and standalone archives per platform (oclif's `pack`), after a
  single-file build (G4 §3.9: Bun only). Lowest priority.

## Later — each reopens a ruling

Added by the owner on 2026-09-24. Each one goes against REQUIREMENTS §3 or §18, and the line says
which; the plan for it starts by saying so.

- **CLI-24** · 🟡 P1 · Voice messages to text with a local speech model, downloaded on first use
  and never bundled. Builds on `max messages download`. The model runs on this machine; audio never
  leaves it. Model: **GigaAM v3** (int8, ~230 MB) through the WebAssembly build of `sherpa-onnx`,
  Silero VAD for audio over 25 s, `ogg-opus-decoder` — no native module (owner, 2026-09-24,
  `NEED-213`; research G5 §3.13). Deferred by the owner the same day, then made the most important
  next item the same evening. Measured 2026-09-24 on Node 24 and Bun 1.3.14: 5 min of Ogg Opus in
  42 s through VAD, ~700 MB peak; without VAD it crashes at 5 min. Done 2026-09-24: `max messages
  transcribe`, `max models audio list|download`, three pinned models (`gigaam-v3`, `gigaam-v3-ctc`,
  `parakeet-v3`), the text kept in the cache (schema 5), MCP tool `max_messages_transcribe`. On the
  owner's own voice messages `gigaam-v3` was best and stays the default (`NEED-235`). Left:
  `--transcribe` on `messages list` and `inbox`.
- **CLI-25** · P3 · `max bot …` — work with a MAX bot through the official bot API and a bot token,
  beside the personal account. Reopens REQUIREMENTS §3 ("not a bot-account client"). Bots are
  issued only to verified organisations, sole traders and the self-employed
  ([dev.max.ru](https://dev.max.ru/docs/maxbusiness/connection)).
- **CLI-27** · P3 · Hooks for workflows: `max` runs a configured command when a check finds
  something new. Asked by the owner 2026-09-24 (`NEED-172`). Two things to settle in the plan: the
  message text reaches that command, so it must go as data on stdin and never into the command
  line; and `max watch --jsonl | <command>` on a running `max serve` (`MAX-35`) already does this
  for live messages, as `max inbox --new` on a schedule does for batches — say what a hook adds
  over those two pipes. Correction 2026-09-24: written before `max serve` existed.
