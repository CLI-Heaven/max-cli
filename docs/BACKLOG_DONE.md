# Backlog — done

Closed items, moved out of [`BACKLOG.md`](BACKLOG.md) so it lists only open work. One line each:
what exists now, and where it is described. The numbers stay reserved — commits and code cite them.

## Foundation and repository

- **CORE-9** — self-update: `max update [--check]` through the package manager that installed it,
  and a daily "newer version" line for a person at a terminal only. `@leemour/cli-core/update` (0.4.0);
  `updateCheck` in `defaults`. `docs/installation.md`, `docs/configuration.md`.
- **CORE-12** — shell completion from the command registry: `@leemour/cli-core/completion` (0.3.0)
  suggests, `max complete zsh|bash|fish|powershell` prints the script (`@bomb.sh/tab`, pinned) and
  answers from the local cache, never the network. `docs/installation.md`.
- **CLI-29** — `docs/commands.md` is rendered from the command registry: one walk of the tree, and
  the commands that change something in MAX are marked.
- **CORE-8** — the command registry, `@leemour/cli-core/commands` (0.2.0): the command tree as data,
  with `origin`, `mutates`, `state` and `examples`; `max commands --json` reads it.
- **CLI-30** — a lint rule marks what any messenger CLI could share: the model, the cache, message
  rendering and name resolution (`src/resolve.ts`) may not import MAX's protocol, session or client.
  ARCHITECTURE §1. Correction 2026-09-24: numbered `CLI-26` until then, a number taken three times.
- **CLI-26** — the first `max session start` of a profile mentions the MAX terms, once and gently
  (`NEED-149`, `src/commands/session.ts`).
- **RES-1** — what moved from `braze-cli` into `cli-core`, file by file.
- **RES-2** — our own WebSocket adapter rather than a third-party MAX client (`NEED-17`).
- **RES-3** — the protocol spec is a TypeScript module, not TypeSpec (`NEED-7`).
- **RES-4** — survey of how agent-driven CLIs are built; its findings shaped the command contract.
- **RES-6** — replaced by `RES-7`.
- **RISK-1** — driving the real account through an unofficial client: accepted by the owner (`NEED-2`).
- **PROTO-4** — replaced by `PROTO-5` in `BACKLOG.md`.
- **CORE-1…CORE-4** — `@leemour/cli-core` extracted from `braze-cli`: output modes, errors and
  exit codes, credentials (keyring, then file), retry primitives, one version for both CLIs.
- **CORE-6** — `node:sqlite` works on Node 22.23 without a flag. Its experimental warning on stderr
  stays (`NEED-59`).
- **CORE-7** — a run log that cannot be written warns once and never kills the command
  (`cli-core` 0.1.1, `onError`; `NEED-133`). `src/runs/recording.ts`.
- **OPS-1** — the npm scope is `@leemour` (`NEED-111`).
- **OPS-2** — one package, not a workspace (`NEED-12`).
- **OPS-5** — a Bun smoke run in CI beside the Node suite.
- **OPS-6** — lint fails when `src/commands/` imports from `src/protocol/`.
- **OPS-7** — `cli-core` published, so `max-cli` installs it from npm.
- **OPS-3, SPEC-0…SPEC-2** — the protocol is declared once in `src/spec/`; the registry, the
  operation table, the wire wrappers and [`protocol.md`](protocol.md) are generated from it, and CI
  fails on drift. [`ARCHITECTURE.md`](ARCHITECTURE.md) §12; `NEED-7`, `NEED-34`, `NEED-35`.
- **OPS-4** — published on npm as `@leemour/max-cli`. How to release: [`releasing.md`](releasing.md).
- **OPS-8** — the tests are typechecked in their own pass.
- **OPS-9** — `scripts/probe.ts` deleted: it never ran and it sent an update opcode. The working
  probes are `pnpm probe:*`.
- **OPS-10** — [`commands.md`](commands.md) is generated from the command tree (`pnpm generate`).
- **OPS-11** — a request the scripted MAX has no answer for fails the test that made it (`src/testing/unscripted.ts`); silence is scripted as `() => undefined`.
- **OPS-12** — `bin/release` says it is waiting for npm before it polls.
- **OPS-13** — `bin/max` runs a worktree build with config, state and cache in its own `.max/`; one `bin/max session start` per worktree (`NEED-136`).

## MAX

- **MAX-30, MAX-31** — groups and channels under `max chats`: `inspect`, `join`, `leave`, `create`,
  `members add|remove`, `admins add|remove`, `update`, `settings`, `requests list|accept|decline`,
  `link reset`. Guarded and journalled as sends (`kind: "chat"`). Measured 2026-09-24
  (`pnpm probe:groups`, `pnpm probe:members`), all but answering a join request (`MAX-41`).
  Deleting a chat stays out (`NEED-32`).
- **MAX-25** — `max messages edit <chat> <message> [text]` changes the text of your own message
  (`MSG_EDIT` 67, measured 2026-09-24). The attachments go back as history gives them, since an
  empty list removes a photo; somebody else's message and a forward are refused before MAX is asked.
  ARCHITECTURE §6, `docs/usage.md`.
- **MAX-26** — `max messages forward <chat> <message> --to <chat>`: `MSG_SEND` with a `FORWARD` link
  and no text, the same one retry with the same `cid` as a send, counted by `sendsPerHour`.
  Measured only from Saved messages to Saved messages. ARCHITECTURE §6, `docs/usage.md`.
- **MAX-27** — `max messages pin <chat> <message> [--notify]` and `max messages unpin <chat>`:
  `CHAT_UPDATE` (55), `pinMessageId: 0` unpins, no notification unless asked (`NEED-196`). Measured
  2026-09-24 in a group. MAX never pins in a personal chat, so the command refuses one before asking.
  `docs/usage.md`.

- **MAX-36** — `session start qr-chrome` and `sms` talk to the browser over
  `--remote-debugging-pipe`, not a port on 127.0.0.1 another local user could reach.
  `src/session/browser.ts`, `docs/security.md`.
- **MAX-16** — `max session start qr | qr-chrome | sms | token`. `qr` draws the code in the terminal
  over our own socket (opcodes 288 → 289 → 291, measured 2026-09-24); `qr-chrome` and `sms` let
  web.max.ru log in inside a throwaway Chromium profile and read its token. SMS over our socket meets
  a captcha, so it has no socket path. `docs/sessions.md`. Correction 2026-09-24: closed as `MAX-23`
  for a while, which `send-media` had claimed first; it keeps `MAX-16`, claimed on 2026-09-23, and the
  watching server moved to `MAX-35`.
- **MAX-1…MAX-3** — our own `MaxClient`, the stored session, domain models mapped from the wire.
  [`ARCHITECTURE.md`](ARCHITECTURE.md) §3–§7.
- **MAX-5** — a person type in the domain model (`src/domain/models.ts`).
- **MAX-6** — contacts, taken from the chats (`NEED-102`); opcode 36 stays unsent (`PROTO-1`).
- **MAX-7** — SQLite cache behind a driver seam; `--offline`, `max cache clear`. §15.
- **MAX-10** — delta login with the stored marker; every group member is named, `max contacts
  sync` re-takes the store. §7, §15.
- **MAX-11** — the token LOGIN returns is stored; `pnpm probe:token` re-measures it. §7.
- **MAX-12** — a token reaches the keyring only after MAX accepts it (`src/session/adopt.ts`), and a
  profile refuses a token from another account. §7.
- **MAX-13** — `max messages search`, over the local index; it never connects. §16.
- **RES-8** — replies and markup when sending: `--reply-to`, and `--markdown` for STRONG,
  EMPHASIZED, STRIKETHROUGH and MONOSPACED, all read back from MAX 2026-09-24 (`NEED-156`).
- **MAX-9** — the rest of the messenger surface: reading attachments, replies, forwards; sending a
  reaction. What was left is split into `MAX-23`…`MAX-33` (2026-09-24).
- **MAX-29** — `max reactions remove`: opcode 179 `{chatId, messageId}`, measured 2026-09-24; a second
  call is answered the same.
- **MAX-14** — `max messages download`: a file's link from opcode 88, a video's from 83, both measured
  2026-09-23; never overwrites (`src/download.ts`).
- **MAX-17** — not doing: an alternative MAX client (web, mobile). Accounts on third-party clients
  get banned, the owner found on 2026-09-24 (`NEED-144`).
- **MAX-18** — an optional recipient list per profile; a send outside it is refused with code 7
  (`src/sends/recipients.ts`, `max recipients`).
- **MAX-19** — `readOnly`: a read-only profile refuses to send with code 5.
- **MAX-20** — `sendsPerHour`, 30 by default: over it, code 8 with the time the next send is possible.
- **MAX-21** — every send attempt journalled without its text, always; `max sends list`.
- **MAX-22** — `max reactions add` goes through the send guards: read-only and the recipient list
  refuse it, it is journalled as `kind: "reaction"`, the hourly limit does not count it (`NEED-168`).
- **MAX-15** — reactions under a message when reading, from opcode 180, one request per page; not cached, `null` offline (`src/client.ts` `#withReactions`).

## The command

- **CLI-23**, **CLI-31** — `max inbox`: other people's unread messages in every chat, as MAX counts
  them; `--new` for what arrived since the last check, the point kept in the profile and moved only
  after printing; `--since` for a one-off look (`src/commands/inbox.ts`, `NEED-171`). Correction 2026-09-24: numbered the unread half `CLI-26` until then, a number taken three times.
- **CLI-1** — the vertical slice: session, account, chats, messages, send.
- **CLI-2** — machine mode: stdout carries one JSON value and nothing else, tested.
- **CLI-3** — every command closes its transport on every exit path, tested.
- **CLI-4, CLI-6** — the configuration file, the order a setting is decided in, the profile as the
  first word, `--quiet`, `--verbose`, `--record` and `max runs`. §13, §14.
- **CLI-7** — `--limit`, `--page`, `--all` on every listing; the `{items, page, limit, hasMore}`
  envelope; `--before` on `messages list` (`NEED-81`, `NEED-86`). §10, §14.
- **CLI-8** — `--silent` on `messages send` (`notify: false`). Only `true` is measured. §6.
- **CLI-9** — `--search` and `--kind` on `chats list`, `--search` on `contacts list`; FTS5 with the
  `trigram` tokenizer. §16.
- **CLI-10** — `--timeout <duration>` bounds the whole command; `MAX_TIMEOUT` (`NEED-119`).
- **CLI-11** — `messages send` reads the body from stdin when the argument is left off.
- **CLI-12** — `max doctor`: token source, keyring entry, login count, profiles, cache schema, run
  directory. Never contacts MAX. `src/diagnose.ts`.
- **CLI-13** — `messages show` and `messages context` (`NEED-130`, `NEED-131`). §10.
- **CLI-14** — `max config show`: every setting and where it came from.
- **CLI-15** — `run(argv, { streams, tty, store, connection })`; tests read what a command prints.
- **CLI-21** — a broken config file names the field, what is wrong and what is allowed (`src/config.ts`).
- **CLI-16** — `messages list --after <id|time>` reads forward; refused together with `--before`. §10.
- **CLI-17** — `chats show <chat>`: one chat with its members (`null` for a channel).
- **CLI-18** — `contacts show <person>` by id, `@username` or name fragment; the chats shared.
- **CLI-20** — `chats list --unread`: only chats MAX counts unread messages in, filtered in SQL.
- **CLI-19** — `max config set|unset`, and a `defaults` block shared by every profile, checked by the
  reader's schema before writing (`src/config.ts`, `changeSetting`).

## Documentation

- **DOC-1** — [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **DOC-2** — the user pages in Russian, indexed by [`README.md`](README.md) (`NEED-108`).
- **DOC-3** — [`skills/max-cli/SKILL.md`](../skills/max-cli/SKILL.md), printed by `max skill show`
  (`NEED-132`).
- **DOC-4** — what the send guards hold and what they do not: `docs/security.md`, the skill.
