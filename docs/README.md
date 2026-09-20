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

## Not written yet, and now scheduled

`installation.md`, `usage.md`, `commands.md` and the rest of the pages a person installing this
would open do not exist. They waited on purpose — `max --help` was the whole reference, and a page
repeating it would be one more thing to keep true — and they are now the work of `DOC-2`, in
**Russian**, alongside the first shareable release (`OPS-4`).

The command reference among them will be **generated** from the program and checked in CI, the way
[`protocol.md`](protocol.md) already is (`OPS-10`): a reference that can drift from the command is
worth less than no reference at all.

`ARCHITECTURE.md` describes the code as it behaves today. **When a document disagrees with the
code, the code is right and the document gets corrected in place.**

The working trail — the handoff, plans, the session journal and the cleanup list — lives in
`docs_ai/` on the machine doing the work and is deliberately not committed.
