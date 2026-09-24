<!-- Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`. -->

# The MAX operations this project knows

Generated from `src/spec/`. Every shape here was written down once, in TypeScript, and the
validators, the opcode registry and this page all come from that one place.

**Confidence** says what the shape rests on. `measured` means we sent it and read the answer;
`confirmed` means two independent implementations agree and we have not run it; `observed`
means one does; `inferred` means it follows from something next to it; `unknown` means the
sources disagree.

| Operation | Opcode | MAX's name | When | Confidence | Where it came from |
|---|---|---|---|---|---|
| `session.init` | 6 | `SESSION_INIT` | before login | measured | measured against MAX 2026-09-19; max-api-docs/protocol/auth.md; tsmax createWebAgent |
| `session.login` | 19 | `LOGIN` | before login | measured | measured against MAX 2026-09-19; measured against MAX 2026-09-20 (`messages` is an object); measured against MAX 2026-09-22 (`token` replaces a stale credential once, then repeats) |
| `session.ping` | 1 | `PING` | after login | confirmed | web.max.ru bundle read 2026-09-24: `cmd(1, {interactive})` every 30 s; PyMax Opcode.PING = 1 |
| `session.logout` | 20 | `LOGOUT` | **never sent** | observed | max-api-docs/protocol/auth.md |
| `login.qrRequest` | 288 | `GET_QR` | before login | measured | measured against MAX 2026-09-24: `session start qr` logged in; PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0; max-api-docs/protocol/auth.md (dac4b19) |
| `login.qrStatus` | 289 | `GET_QR_STATUS` | before login | measured | measured against MAX 2026-09-24: `session start qr` logged in; PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0; max-api-docs/protocol/auth.md (dac4b19) |
| `login.byQr` | 291 | `LOGIN_BY_QR` | before login | measured | measured against MAX 2026-09-24: `session start qr` logged in; PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0 |
| `login.qrApprove` | 290 | `AUTH_QR_APPROVE` | **never sent** | observed | PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0 |
| `login.smsRequest` | 17 | `AUTH_REQUEST` | before login | confirmed | PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0; max-api-docs/protocol/auth.md (dac4b19) |
| `login.smsCode` | 18 | `AUTH` | before login | confirmed | PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0; max-api-docs/protocol/auth.md (dac4b19) |
| `login.password` | 115 | `AUTH_LOGIN_CHECK_PASSWORD` | before login | measured | measured against MAX 2026-09-24: `session start qr` on an account with a cloud password; PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0 |
| `contacts.info` | 32 | `CONTACT_INFO` | after login | measured | measured against MAX 2026-09-19: asked for ten, got ten |
| `contacts.byPhone` | 46 | `CONTACT_INFO_BY_PHONE` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`): the owner's own number answered with the owner; web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `search_by_phone` |
| `contacts.update` | 34 | `CONTACT_UPDATE` | after login | confirmed | web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `add_contact`, `remove_contact` |
| `contacts.import` | 21 | `SYNC` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`), the owner's own number only: answered `{phones: {<number>: <number>}}` and no contact; PyMax 53103f0 `import_contacts` |
| `protocol.unidentified36` | 36 | `UNIDENTIFIED_36` | **never sent** | unknown | tsmax and PyMax call it CONTACT_LIST; max-api-docs calls it GET_BLOCKED; measured against MAX 2026-09-20: `{}` and `{marker}` are refused with `proto.payload`, `{marker, count}` closes the connection |
| `account.update` | 16 | `PROFILE` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`): the profile rewritten with its own values answered `{profile}` shaped like LOGIN's; web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `change_profile`; measured against MAX 2026-09-19: refused an empty payload |
| `account.sessions` | 96 | `SESSIONS_INFO` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`): `{client, current, info, location, time}` per session — no id; web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `get_sessions` |
| `account.closeSessions` | 97 | `SESSIONS_CLOSE` | after login | confirmed | web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `close_all_sessions` |
| `folders.list` | 272 | `FOLDERS_GET` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`): no folder of the owner's carries `include`; web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `get_folders` |
| `folders.update` | 274 | `FOLDERS_UPDATE` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`): created, renamed and deleted a folder; a 21-character title came back `folder.validation.title.too-long`, 15 was taken; web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `create_folder`, `update_folder` |
| `folders.delete` | 276 | `FOLDERS_DELETE` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:account`); web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24; PyMax 53103f0 `delete_folder` |
| `chats.history` | 49 | `CHAT_HISTORY` | after login | measured | measured against MAX 2026-09-19 |
| `chats.mark` | 50 | `CHAT_MARK` | after login | observed | PyMax `api/messages/service.py` read_message, `payloads.py` ReadMessagesPayload, `types/domain/message.py` ReadState (53103f0); tsmax; max-api-docs/protocol/chats.md |
| `chats.list` | 53 | `CHATS_LIST` | after login | measured | measured against MAX 2026-09-19; max-api-docs/protocol/chats.md |
| `chats.linkInfo` | 89 | `LINK_INFO` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:groups`); PyMax resolve_group_by_link |
| `chats.join` | 57 | `CHAT_JOIN` | after login | measured | measured against MAX 2026-09-24 with a private group link (`pnpm probe:groups`); PyMax join_group |
| `chats.leave` | 58 | `CHAT_LEAVE` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:groups`); PyMax leave_group |
| `chats.update` | 55 | `CHAT_UPDATE` | after login | measured | measured against MAX 2026-09-24 (`pnpm probe:groups`, `pnpm probe:members`); PyMax change_group_profile, change_group_settings, rework_invite_link; the pin: measured 2026-09-24 in a group the owner named (`pnpm probe:edit-pin-forward`, `PIN_CHAT`); web.max.ru `_app/immutable/chunks/5oCuRT0F.js`; PyMax `api/messages/payloads.py:95-98` (53103f0) |
| `chats.members` | 59 | `CHAT_MEMBERS` | after login | measured | measured against MAX 2026-09-24 with no requests (`pnpm probe:groups`); PyMax get_join_requests |
| `chats.updateMembers` | 77 | `CHAT_MEMBERS_UPDATE` | after login | measured | measured against MAX 2026-09-24 with a second person who agreed (`pnpm probe:members`): add, make admin, take admin back, remove; PyMax invite_users_to_group, remove_users_from_group, add_admin, confirm_join_request, decline_join_request |
| `chats.delete` | 52 | `CHAT_DELETE` | **never sent** | observed | PyMax delete_chat; tsmax |
| `messages.send` | 64 | `MSG_SEND` | after login | measured | measured against MAX 2026-09-19, including deduplication by `cid` across two connections; `link` and `elements` measured 2026-09-23 in Saved messages (`pnpm probe:reply`); shapes from tsmax and PyMax; the FORWARD link: web.max.ru `_app/immutable/chunks/5oCuRT0F.js` (2026-09-24), PyMax `api/messages/payloads.py:56-73`; a forward with no `text` and no `elements` measured 2026-09-24 in Saved messages (`pnpm probe:edit-pin-forward`); group creation measured 2026-09-24 (`pnpm probe:groups`); shape from PyMax create_group |
| `messages.edit` | 67 | `MSG_EDIT` | after login | measured | measured against MAX 2026-09-24 in Saved messages (`pnpm probe:edit-pin-forward`); web.max.ru `_app/immutable/chunks/5oCuRT0F.js` (2026-09-24); PyMax `api/messages/payloads.py:21-28` (53103f0) |
| `messages.react` | 178 | `MSG_REACTION` | after login | measured | measured against MAX 2026-09-23 in Saved messages (`pnpm probe:reply`); tsmax addReaction; PyMax add_reaction |
| `messages.unreact` | 179 | `MSG_CANCEL_REACTION` | after login | measured | measured against MAX 2026-09-24 in Saved messages; tsmax removeReaction; PyMax remove_reaction |
| `messages.reactions` | 180 | `MSG_GET_REACTIONS` | after login | measured | measured against MAX 2026-09-24 in Saved messages (`pnpm probe:message-shapes`); tsmax getReactions; PyMax get_reactions |
| `messages.delete` | 66 | `MSG_DELETE` | **never sent** | observed | tsmax |
| `attachments.video` | 83 | `VIDEO_PLAY` | after login | measured | measured against MAX 2026-09-23 (`pnpm probe:download`); tsmax getVideoById; PyMax get_video_by_id |
| `attachments.file` | 88 | `FILE_DOWNLOAD` | after login | measured | measured against MAX 2026-09-23 (`pnpm probe:download`); tsmax getFileById; PyMax get_file_by_id |
| `uploads.photo` | 80 | `PHOTO_UPLOAD` | after login | measured | measured against MAX 2026-09-24 in Saved messages (`pnpm probe:upload`); PyMax upload_photo |
| `uploads.file` | 87 | `FILE_UPLOAD` | after login | measured | measured against MAX 2026-09-24 in Saved messages (`pnpm probe:upload`); PyMax upload_file |

## The numbers that are declared and never sent

A number in the registry is not permission to use it.

- **LOGOUT** (20) — `max session end` forgets the token locally and tells MAX nothing. Ending the session server-side would also end it for the browser tab the token came from, which is not what the command promises.
- **AUTH_QR_APPROVE** (290) — The phone's side of a QR login: it lets whoever showed the code into the owner's account. A CLI logging itself in never approves anybody.
- **UNIDENTIFIED_36** (36) — Nobody agrees what it is: tsmax and PyMax call it `CONTACT_LIST`; the protocol documentation calls it `GET_BLOCKED`. Sent once with the owner's permission on 2026-09-20 and it exists — but it refuses every payload we can guess, and one guess closed the connection. It stays unsent until somebody watches a real client send it (`PROTO-1`).
- **CHAT_DELETE** (52) — Deleting a chat is left out of MAX-31 for the reason of `NEED-32`: a tool that can destroy a conversation for everyone in it is a poor trade for tidiness.
- **MSG_DELETE** (66) — Deliberately never called. Giving this tool the ability to destroy somebody's messages, in order to tidy up after a test, is a poor trade (`NEED-32`).
