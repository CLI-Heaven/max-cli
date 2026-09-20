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

## Not written yet

`installation.md`, `usage.md` and the rest of the pages a person installing this would open do not
exist yet. They are `DOC-2`, in **Russian** (`NEED-108`), alongside the first shareable release
(`OPS-4`).

`ARCHITECTURE.md` describes the code as it behaves today. **When a document disagrees with the
code, the code is right and the document gets corrected in place.**

The working trail — the handoff, plans, the session journal and the cleanup list — lives in
`docs_ai/` on the machine doing the work and is deliberately not committed.
