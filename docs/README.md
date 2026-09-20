# Documentation

`max` is a command line interface for a personal MAX Messenger account. Seven commands work
against the real service — `session start|end`, `account show`, `chats list`, `contacts list`,
`messages list|send` — and two more answer from this machine: `max cache` and `max runs`. The
protocol underneath is unofficial and reverse-engineered.

⚠ **Correction 2026-09-20: this page said "six commands" and named none of them.** It was written
before the rename (`NEED-48`), the cache (`MAX-7`) and the run log (`CLI-4`).

## Building it

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | how it is built **now**, and which seams you may not cross |
| [REQUIREMENTS.md](REQUIREMENTS.md) | the owner's brief, cited by section number |
| [DECISIONS.md](DECISIONS.md) | what was ruled, and why — read before "fixing" something odd |
| [CONVENTIONS.md](CONVENTIONS.md) | how code and documents are written here |
| [TESTING.md](TESTING.md) | how to check it yourself, and what each check is for |
| [BACKLOG.md](BACKLOG.md) | what is left |

## Reference — generated, never hand-written

| | |
|---|---|
| [commands.md](commands.md) | every command, option and exit code — **generated**, `pnpm generate` |
| [protocol.md](protocol.md) | every opcode and where its shape came from — **generated** |

Neither is edited by hand. `pnpm generate` rewrites both and CI asserts the tree did not change,
so a reference that quotes a command the program no longer has cannot reach `main`.

## Using it — Russian, per `NEED-108`

| | |
|---|---|
| [installation.md](installation.md) | установка, требования, куда ложатся файлы, обновление |
| [usage.md](usage.md) | вход, профили, чтение, отправка, диагностика, настройки |

Still to come, and tracked as `DOC-2`: `sessions.md`, `configuration.md`, `diagnostics.md`,
`security.md`, `troubleshooting.md`, `releasing.md` and a `CHANGELOG.md`. The two pages above are
the ones the release needs — a person can install the tool and read their chats from them alone,
which is the readiness test the plan sets.

`ARCHITECTURE.md` describes the code as it behaves today. **When a document disagrees with the
code, the code is right and the document gets corrected in place.**

The working trail — the handoff, plans, the session journal and the cleanup list — lives in
`docs_ai/` on the machine doing the work and is deliberately not committed.
