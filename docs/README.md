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
| [architecture/](architecture/) | its detail: session and login sync, reading messages, the store and search |
| [REQUIREMENTS.md](REQUIREMENTS.md) | the owner's brief, cited by section number |
| [DECISIONS.md](DECISIONS.md) | what was ruled, and why — read before "fixing" something odd |
| [CONVENTIONS.md](CONVENTIONS.md) | how code and documents are written here |
| [TESTING.md](TESTING.md) | how to check it yourself, and what each check is for |
| [BACKLOG.md](BACKLOG.md) | what is left |
| [BACKLOG_DONE.md](BACKLOG_DONE.md) | what is closed, one line each |

## Reference — generated, never hand-written

| | |
|---|---|
| [commands.md](commands.md) | every command, option and exit code — **generated**, `pnpm generate` |
| [protocol.md](protocol.md) | every opcode and where its shape came from — **generated** |

Neither is edited by hand. `pnpm generate` rewrites both and CI asserts the tree did not change,
so a reference that quotes a command the program no longer has cannot reach `main`.

## Using it — Russian, per `NEED-108`

Каждая страница отвечает на один вопрос и открывается под задачу, а не читается подряд.

| | |
|---|---|
| [installation.md](installation.md) | установка, требования, куда ложатся файлы, обновление |
| [usage.md](usage.md) | вход, профили, чтение, страницы, отправка, машинный режим — по порядку |
| [sessions.md](sessions.md) | откуда берётся токен, ключница, профили, `MAX_TOKEN` |
| [configuration.md](configuration.md) | каждая настройка, каждая переменная, порядок разрешения |
| [mcp.md](mcp.md) | MCP-сервер для клиентов без терминала: подключение, отправка, соединение с MAX |
| [diagnostics.md](diagnostics.md) | `--trace`, `--record`, `max runs` — и чего в записи нет |
| [security.md](security.md) | что попадает на диск, а что не попадает никогда |
| [troubleshooting.md](troubleshooting.md) | по симптому: что видно на экране и что делать |
| [releasing.md](releasing.md) | как выпускается версия, и кем |
| [../CHANGELOG.md](../CHANGELOG.md) | что изменилось между версиями |

`ARCHITECTURE.md` describes the code as it behaves today. **When a document disagrees with the
code, the code is right and the document gets corrected in place.**

The working trail — the handoff, plans, the session journal and the cleanup list — lives in
`docs_ai/` on the machine doing the work and is deliberately not committed.
