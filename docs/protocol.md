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
| `session.logout` | 20 | `LOGOUT` | **never sent** | observed | max-api-docs/protocol/auth.md |
| `contacts.info` | 32 | `CONTACT_INFO` | after login | measured | measured against MAX 2026-09-19: asked for ten, got ten |
| `account.update` | 16 | `PROFILE` | **never sent** | measured | measured against MAX 2026-09-19: refused an empty payload |
| `protocol.unidentified36` | 36 | `UNIDENTIFIED_36` | **never sent** | unknown | tsmax and PyMax call it CONTACT_LIST; max-api-docs calls it GET_BLOCKED; measured against MAX 2026-09-20: `{}` and `{marker}` are refused with `proto.payload`, `{marker, count}` closes the connection |
| `chats.history` | 49 | `CHAT_HISTORY` | after login | measured | measured against MAX 2026-09-19 |
| `chats.mark` | 50 | `CHAT_MARK` | **never sent** | confirmed | tsmax; max-api-docs/protocol/chats.md |
| `chats.list` | 53 | `CHATS_LIST` | after login | measured | measured against MAX 2026-09-19; max-api-docs/protocol/chats.md |
| `messages.send` | 64 | `MSG_SEND` | after login | measured | measured against MAX 2026-09-19, including deduplication by `cid` across two connections; `link` and `elements` measured 2026-09-23 in Saved messages (`pnpm probe:reply`); shapes from tsmax and PyMax |
| `messages.react` | 178 | `MSG_REACTION` | after login | measured | measured against MAX 2026-09-23 in Saved messages (`pnpm probe:reply`); tsmax addReaction; PyMax add_reaction |
| `messages.delete` | 66 | `MSG_DELETE` | **never sent** | observed | tsmax |
| `attachments.video` | 83 | `VIDEO_PLAY` | after login | measured | measured against MAX 2026-09-23 (`pnpm probe:download`); tsmax getVideoById; PyMax get_video_by_id |
| `attachments.file` | 88 | `FILE_DOWNLOAD` | after login | measured | measured against MAX 2026-09-23 (`pnpm probe:download`); tsmax getFileById; PyMax get_file_by_id |

## The numbers that are declared and never sent

A number in the registry is not permission to use it.

- **LOGOUT** (20) — `max session end` forgets the token locally and tells MAX nothing. Ending the session server-side would also end it for the browser tab the token came from, which is not what the command promises.
- **PROFILE** (16) — It does not read a profile, it updates one, and it refuses an empty payload. Your own profile arrives with the login response, so nothing needs to send this. It is declared here so that fact keeps a home.
- **UNIDENTIFIED_36** (36) — Nobody agrees what it is: tsmax and PyMax call it `CONTACT_LIST`; the protocol documentation calls it `GET_BLOCKED`. Sent once with the owner's permission on 2026-09-20 and it exists — but it refuses every payload we can guess, and one guess closed the connection. It stays unsent until somebody watches a real client send it (`PROTO-1`).
- **CHAT_MARK** (50) — Reading is observational by construction. Marking a conversation read is a change to somebody's account that no read command asked for, so 50 is declared here and never sent — and `src/client.test.ts` asserts its absence from everything the client sent.
- **MSG_DELETE** (66) — Deliberately never called. Giving this tool the ability to destroy somebody's messages, in order to tidy up after a test, is a poor trade (`NEED-32`).
