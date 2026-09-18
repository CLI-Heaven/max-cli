# max-cli — working rules

**Start with [`docs_ai/HANDOFF.md`](docs_ai/HANDOFF.md).** What this is, the layout, what to read
for which task, and the rules that cost time when broken. It is short; read it before anything
else.

`docs_ai/` is the working trail — handoff, plans, session journal, cleanup list — and it is **not
in git**. A fresh clone does not have it. When it is absent, start from
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) and [`docs/BACKLOG.md`](docs/BACKLOG.md) instead,
and create `docs_ai/` as you go.

Then the one reference that covers what you are about to touch —
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for how code and documents are written here, and
`docs/ARCHITECTURE.md` for the seams once it exists.

## Where this project actually is

**Nothing is built.** There is a brief, a backlog and these rules. The next piece of work is the
architecture proposal the brief asks for ([`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) §31), and
it has to be written against **real code** — `../braze-cli` and the current source of the MAX
client candidates — not against their READMEs and not from memory.

Do not start implementing the CLI before that proposal is accepted. Do not create
`docs/ARCHITECTURE.md` before it either: a document describing how something is built, written
before it is built, is the one kind of doc that cannot be corrected later because nobody knows it
is wrong.

## The constraints that shape everything

1. **This is the owner's real personal messenger account on an unofficial protocol.** A mistake
   here does not fail a test, it sends a message to a person or locks an account. Nothing sends,
   marks read, or acknowledges anything unless the command the owner typed asked for it.
2. **In machine mode, stdout carries data and nothing else.** No spinner, no `✓`, no warning, no
   ANSI. Diagnostics go to stderr. This is the contract agents depend on and it gets a test.
3. **One-shot means the process exits.** Whatever opens a socket, a timer or a listener closes it
   on every exit path. A command that prints its result and hangs is a defect.
4. **No third-party MAX type crosses the adapter.** Above it, only our own domain models — so the
   reverse-engineered library underneath can be replaced.
5. **Messages, tokens and phone numbers never reach a log, a fixture or a document.** Command
   output is where a message the owner asked to read is allowed to appear, and nowhere else.

## Plan before building

For anything that is not a one-file, one-step change, **write the plan first and stop for
review**:

1. Orient — read the relevant code and docs. No edits.
2. Write the plan into [`docs_ai/plans/`](docs_ai/plans/) and show it. Wait for approval.
3. Build against it, and correct the plan when reality diverges.

The plan states: the goal, the current state with `path:line` anchors, the decisions being made
and why, ordered work items, the test plan, and the open questions. Flag anything needing a
product decision instead of guessing.

A typo, a broken line, an obvious one-line bug — just fix it.

## Evidence, not recollection

Everything about the MAX protocol is somebody's reverse engineering, and half of it is out of
date. **A README is a claim; the current source is evidence; a captured frame is proof.** Say
which of the three a statement rests on, every time — [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

The same applies to this repository's own documents. A document claiming something is broken,
unfinished or not started is a snapshot of someone else's day:

```sh
git log -S'<string that should not be there>' -- <path>
git log --oneline -1 -- <path>
```

A discrepancy you find gets **corrected in the document that is wrong, in place**, marked as a
correction. A note appended at the bottom does not count — the next reader reads the top.

## Comments

Sparse, and only *why*. The global rule in `~/.claude/CLAUDE.md` applies and overrides what any
surrounding file looks like. No comment restating the line above it, no section banners, no
narrating the change you just made.

## Record the trail as you go

This repository keeps a [session journal](docs_ai/journal/README.md). Take numbers with
`docs_ai/journal/note.sh`, which allocates and writes in one operation, and **write the entry when
you find the thing, not at the end of the session**.

A number that appeared in a reply and is missing from the journal is precisely the failure the
journal exists to prevent.

## Deletions

**Never delete or clean up mid-task.** Append a line to
[`docs_ai/CLEANUP.md`](docs_ai/CLEANUP.md) — the path, why it should go, the date — and do the
removals in one batch at the end, after the owner confirms. This covers files, branches,
worktrees, generated artifacts and temp directories.

Exception: something that *is* the task ("remove the old X"), or a file you created earlier in the
same session and no longer need.

**Never kill a process by name.** No `pkill`, no `killall`. Find the PID, confirm it is yours,
kill that PID.

## Committing

Conventional commits. Run the relevant checks before committing — once there are any. Work on a
branch off `main` and open a pull request; the scaffold commit is the one exception, because
there is no `main` to branch from yet.
