# Documentation

`max` is a command line interface for a personal MAX Messenger account. Six commands work against
the real service; the protocol underneath is unofficial and reverse-engineered.

## Building it

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | how it is built **now**, and which seams you may not cross |
| [REQUIREMENTS.md](REQUIREMENTS.md) | the owner's brief, cited by section number |
| [DECISIONS.md](DECISIONS.md) | what was ruled, and why — read before "fixing" something odd |
| [CONVENTIONS.md](CONVENTIONS.md) | how code and documents are written here |
| [TESTING.md](TESTING.md) | how to check it yourself, and what each check is for |
| [BACKLOG.md](BACKLOG.md) | what is left |

## Not written yet, on purpose

`installation.md`, `usage.md` and `commands.md` wait until there is a release to install: `max
--help` is currently the whole of the command reference, and a page repeating it would be one more
thing to keep true.

`ARCHITECTURE.md` describes the code as it behaves today. **When a document disagrees with the
code, the code is right and the document gets corrected in place.**

The working trail — the handoff, plans, the session journal and the cleanup list — lives in
`docs_ai/` on the machine doing the work and is deliberately not committed.
