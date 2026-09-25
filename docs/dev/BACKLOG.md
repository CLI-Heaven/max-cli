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
  send guard (`src/client.ts`, `chats.markRead`). Left: measure `CHAT_MARK` (50) — the request is
  PyMax's shape (`READ_MESSAGE`, `mark` in ms), never sent to the real MAX; the owner was logged
  out on 2026-09-24 (`NEED-226`). Plan: `docs_ai/plans/2026-09-24-cli-33-mark-read.md`.
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
- **MAX-28** · ⏸️ P1 · Polls: show them when reading, and vote (`vote_poll`, `SEND_VOTE` 304
  `{chatId, messageId, pollId, answersIds}`). Creating one is a `_type: "POLL"` attachment on
  `MSG_SEND` 64 (PyMax 2.4.1, code; no user report).
  ⏸️ Deferred by the owner 2026-09-25: web.max.ru does not show polls yet («Обновите MAX…»),
  creating one over JSON is refused with `proto.payload`; PR #108 closed, branch
  `feat/max-28-polls` kept.
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
- **MAX-51** · P2 · Chats since the last login again. Over JSON the stored marker went in all four
  `*Sync` fields of LOGIN and MAX answered only the chats that changed; since `MAX-40` it goes in
  `contactsSync` only (`src/session/handshake.ts`), as web.max.ru sends it, so every login brings the
  whole chat list (27 chats, ~25 KB, measured 2026-09-25). The refusal that led there was a float64
  on the wire, not the field (`FIND-163`) — putting the marker back in `chatsSync` may well work.
  One login to measure. Also from the MAX-40 plan: history pages of 30, as the web client asks.
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
  (we send 0). Check first that `max chats list` loses nothing with 15. Same capture.
- **MAX-54** · P3 · Does MAX close `max serve`'s socket every ~4 minutes, as it did the hidden tab's
  (code 1000, then a re-login with `lastLogin` and `configHash`)? Run `max serve` for 10 minutes. If
  it does, the re-login should carry those two fields. Same capture.

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
