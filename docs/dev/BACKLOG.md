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

- **MAX-56** · P1 · **Before announcing a public release:** run every writing command once over the
  binary protocol, in Saved messages, with the owner's yes (`NEED-150`): send, reply, forward, edit,
  pin, react, delete, a photo and a file, scheduled send, `chats read` (`CHAT_MARK` 50 — never
  measured, on JSON or binary), profile update, a folder, a group with a member. Only reading was run
  live after `MAX-40` (login, chats, history, through `max serve`); 0.9.0 is already on npm. The
  codec changed how ids (extension 1) and times (int64) go out, so a refusal would show as
  `proto.payload`. One script, one login, a line per operation.
- **MAX-55** · P1 · **Before announcing a public release:** INIT built from this machine, as
  web.max.ru builds it from the browser. Today `src/spec/identity.ts` holds the owner's browser, so
  every install would present Europe/Madrid and Linux Chrome. The web client takes `timezone` from
  `Intl`, `headerUserAgent` from `navigator.userAgent`, `screen` as `height×width` plus pixel ratio,
  and `deviceLocale` from the browser language (web.max.ru code, read 2026-09-25,
  `docs/dev/capture/2026-09-25-web-tab.md`). Take timezone and language from the system, pick the
  user agent and `osVersion` for the host OS with a current Chrome version, and store them with the
  device id so they do not change per run (HANDOFF bite 8).
- **MAX-50** · P2 · When the keyring does not answer, say so instead of "no session — run `max session
  start`". Measured 2026-09-25 from cron on Linux: no `XDG_RUNTIME_DIR`, the keyring is unreachable,
  and `max` tells the owner to log in again although the profile's state file holds a `viewerId`
  and hundreds of logins — following that advice is one more login and a new device. Starts at
  `src/client.ts:1375`: a missing token with a state file that has logged in is the keyring, not the
  session; `max doctor` says `token present: false` the same way. Workaround in `docs/recipes.md`.

- **CLI-34** · P2 · `max backup messages <chat> --since <date> | --last
  <n>`: without `--run` only the estimate (what the cache holds, what is missing, requests and
  minutes); with `--run` it fills the gaps within limits and stops on any error. One chat per call
  (`NEED-217`). Defaults measured on web.max.ru 2026-09-25 (`RES-9`): 30 messages back per page,
  `forward: 0`, the next page starts at the time of the oldest message loaded (it comes back again),
  a page shorter than 30 is the start of the chat; the web client sets no pause of its own.
  Plan: `docs_ai/plans/2026-09-24-history-backup.md`.
- **CLI-33** · 🟡 P2 · Mark a chat read on request. Done: `max chats read <chat> [--until <id>]`,
  `messages list --mark-read`, MCP `max_chats_read` behind `--allow-mark-read`; kind `read` in the
  send guard (`src/client.ts`, `chats.markRead`). Left: what the web client sends — `RES-10`.
  Correction 2026-09-25: `CHAT_MARK` (50) is measured — PyMax's shape was accepted in Saved
  messages by `pnpm smoke:live` (`MAX-56`). Plan: `docs_ai/plans/2026-09-24-cli-33-mark-read.md`.
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
- **MAX-24** · 🚩 P1 · Send a voice message. The upload works (opcode 82, `uploaderType: 1` for
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
- **MAX-51** · P2 · The `chatsSync` marker, as the tab uses it. Captured 2026-09-25
  (`docs/dev/capture/2026-09-25-web-tab.md`): a fresh tab sends `chatsSync: 0`; only a re-login on the
  same page sends a marker, and that marker is **not** the previous login's time — that goes in a new
  field, `lastLogin`, beside `configHash`. So: `0` on a fresh connection (every one-shot command,
  and `max serve`'s first login), a marker only when `max serve` logs in again. What the marker is
  remains open: have the recorder keep the LOGIN answer's `time` and `chatMarker` (as `t0+N`) and
  match them in the next capture. Over JSON the stored marker went in all four fields and MAX
  answered only changed chats; the refusal after `MAX-40` was a float64, not the field (`FIND-163`).
- **MAX-34** · P3 · Live events: a long-running `max listen` that prints new messages, edits,
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
- **MAX-52** · P2 · The requests a real tab sends right after LOGIN: 21 on a fresh start
  (`48 48 272 35 32 302 163 208 27×4 209 28 22 48 28 35 53 209 35`) and 9 after a re-login. `max`
  sends none, which shows on every login — a stronger difference than telemetry. Decide per
  request: the read-only ones (272 folders, 302 banners, 163 call history, 27) could be copied; 22
  subscribes to push and changes state. Captured 2026-09-25, `docs/dev/capture/2026-09-25-web-tab.md`.
- **MAX-53** · P2 · LOGIN as the tab sends it: `chatsCount: 15` (we send 40) and `presenceSync: -1`
  (we send 0). **Tied to opcode 208:** the tab asks LOGIN for 15 chats and pages the rest with
  `208 {cursor, count: 15}`. Changing only the number would lose chats in `max chats list`.
  Same capture.

- **RES-5** · 🟡 P2 · Does `LOGIN` move presence or read state? Reading history does not (no
  `CHAT_MARK`, tested). Partly answered by the capture of 2026-09-25: the tab's own LOGIN sends
  `interactive: false` too; `true` goes only in pings, while its window has focus. Left: whether
  opening a chat with unread messages marks it read without opcode 50 — see `RES-10`.
- **RES-10** · P2 · Record the tab opening **one unread chat** (`docs/dev/capture/recording.md`),
  with the owner's yes: it will be marked read, as the owner opening it would. Answers three things
  at once: the real shape of `CHAT_MARK` 50 (`CLI-33` sends PyMax's), whether a history request
  without `interactive` marks the chat read (`RES-5`; we add `interactive: false` to opcode 49, which
  the tab never sends — a difference on the most common read), and whether the tab sends 75
  (subscribe to the chat) or 50 on its own.
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
- **MAX-39** · P2 · Notice when the client version we present goes stale. `appVersion` is
  `26.9.8`, read from the web client on 2026-09-25 (`src/spec/identity.ts`); PyMax broke when MAX
  began refusing an old one ([#86](https://github.com/MaxApiTeam/PyMax/issues/86)). The recorder
  (`scripts/capture/web-recorder.js`) now reads the current one from a tab; `max doctor` could say
  when ours is behind. The Chrome version in `headerUserAgent` ages the same way (`MAX-55`).
  Correction 2026-09-25: this line said `26.5.5`, which `MAX-40` replaced.
- **CORE-10** · P3 · Plugins from npm, **only from an allow-list** kept in the CLI itself — package
  names with pinned versions and integrity hashes — never an arbitrary package: a plugin runs inside
  a program holding the token of a personal account. oclif's `plugin-plugins` is the model.
- **CORE-11** · P3 · Installers and standalone archives per platform (oclif's `pack`), after a
  single-file build (G4 §3.9: Bun only). Lowest priority.
- **CORE-5** · ⏸️ P3 · Move `braze-cli` onto `@leemour/cli-core` instead of its own copy. Deferred by
  the owner.

## Later — each reopens a ruling

Added by the owner on 2026-09-24. Each one goes against REQUIREMENTS §3 or §18, and the line says
which; the plan for it starts by saying so.

- **CLI-24** · 🟡 🚧 `cli-24-transcribe` · P1 · Voice messages to text with a local speech model, downloaded on first use
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
