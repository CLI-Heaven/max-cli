# Conventions

How code and documents are written here. Short on purpose — the linter is the authority on
formatting, and this file only covers what a linter cannot say.

Adapted from the sibling project `braze-cli`, which is where most of these were learned. Two of
its rules are **deliberately inverted or weakened** here and are marked below; copying them
unchanged would import a constraint this project does not have.

## Code

**The linter decides formatting.** Biome settles indentation, quotes, semicolons, line width and
import order. Do not argue with it and do not hand-format around it. For the record: 2-space
indent, double quotes, no semicolons, 120 columns.

**TypeScript, strict, and no `any`.** `noUncheckedIndexedAccess` on, so an index access is
`T | undefined` and you have to handle it. `noExplicitAny` is an error, not a warning.

**Functional in the small, classes where identity matters.** A client that holds a connection and
a session is a class; everything else is a function taking its inputs.

**Comments are sparse and say *why*.** A comment earns its place by recording a decision, warning
about a trap, or naming a constraint that is invisible locally. Never narrate a change, never
leave commented-out alternatives. If it would be obvious to a competent reader of TypeScript,
delete it.

**Wire names live below the adapter; our names live above it.** ⚠ *This is the opposite of
`braze-cli`, where Braze's own field names survive into the public types unchanged.* Braze
publishes its field names and a reader has its documentation open; MAX does not and nobody does.
So a raw protocol field keeps its wire spelling inside the protocol and adapter layers, where it
has to match captured traffic — and above the adapter only our own domain model exists
(`lastMessageAt`, not whatever the frame happens to call it). A raw MAX object never reaches CLI
output except behind an explicit debug/raw option —
[`REQUIREMENTS.md`](REQUIREMENTS.md) §16, §25.

**Reusable core code stays Node-light, and this is a weaker rule than it looks.** ⚠ *`braze-cli`
requires its core to run unchanged in a Cloudflare Worker and enforces that with three gates.
That is not a requirement here.* The brief asks only for "minimal coupling to Node-specific APIs
in reusable core code **where practical**" (§2). The reason to keep `cli-core` free of Node
specifics is that it has to serve more than one CLI and be testable without a filesystem, a
terminal or a clock — not that it has to run in a Worker. Do not import the three-gate apparatus
until something actually needs it.

**Core takes its environment as arguments.** If reusable code needs to know anything about the
machine it runs on — the time, the filesystem, the keyring, the terminal, randomness — it takes
it as a parameter. That is what makes timeout, retry and session expiry testable without waiting.

**One-shot means one-shot.** Anything that opens a connection, a timer or a listener owns closing
it, in a `finally` or an equivalent lifecycle wrapper. A command that prints its result and then
hangs is a defect, not a rough edge — §18.

**Never log a credential, and never pass one to a logger "because it's redacted".** Redaction is
the second line of defence, not the first. Message bodies are not credentials, but they are not
diagnostics either: they belong in command output, never in a log — §14.

**Report honestly.** If a test failed, show the output. If something could not be verified, say
which thing and why. "Probably works" is a sentence you are allowed to write; a green tick you did
not earn is not.

**Say where a protocol fact came from.** This is an unofficial protocol, so every opcode, field
and shape is somebody's observation. Record whether ours is confirmed by several independent
implementations, seen in one, inferred, or a guess — §10. An unsourced constant is the thing that
will be impossible to re-derive when MAX changes.

## Documents

The point is that six weeks from now, a person or an agent with no memory of the work can open a
doc and act on it **without reading the code first, and without being misled**. A doc that is
merely incomplete costs some time; a doc that is confidently stale costs a wrong decision.

**Say what has never been verified, at the top.** Each doc opens with a status line naming what is
built, what is measured and what rests on assumption. This costs one paragraph and is the
difference between a doc you can act on and one you have to audit.

**Separate what you saw from what you inferred.** Something you ran gets a command and its
output. Something you read in documentation is "the docs describe X" — reading docs is not
verification. For MAX this applies twice over: a claim in another project's README is not even
documentation, it is a claim, until its current source says the same thing.

**Anchor every claim.** `path/file.ts:123` for our code, a URL for anything external, a commit for
anything historical. A claim without an anchor is an opinion.

**Correct in place; never append.** A doc where the truth lives in a note at the bottom is a doc
that lies at the top. Rewrite the wrong sentence. If the wrong version circulated, mark the fix —
do not hide it.

**One fact, one home.** A decision lives in [`DECISIONS.md`](DECISIONS.md); a task lives in
[`BACKLOG.md`](BACKLOG.md); something to delete lives in `docs_ai/CLEANUP.md`; a plan lives in
`docs_ai/plans/`. Everywhere else links to it. Two copies of a fact drift, and the reader cannot
tell which is current.

**Write the trap, not the rule.** "Close the connection" is weaker than "a MAX WebSocket left open
keeps the process alive after the result has printed, so a script that pipes `max chats --json`
never returns." The failure mode is what the reader needs to recognise.

**No inventories, no archaeology, no placeholders.** A table of every class ages instantly. How a
name was chosen is not useful; what it *is*, is. `<your-chat-id>` gets read as a literal — paste a
real value from a real run.

**Leave a section out rather than filling it with placeholder prose.** An empty heading is honest;
invented content is not. This is why there is no `ARCHITECTURE.md` in this repository yet: nothing
has been built, and a document describing how it is built would be fiction.

**A command you hand someone is a snapshot, not a template.** Never put a placeholder inside a
runnable command — in `braze-cli` a placeholder endpoint was pasted verbatim into a real config.
Either the real value goes in, or the value is asked for as a plain question first.

**Never paste a real chat id, phone number, token or message into a committed document.** The same
rule as the fixtures — §24. Redact, or use an obviously synthetic value and say that it is one.

**English in committed documents.** The session journal is Russian, because it is the owner's own
trail. Do not mix languages inside one file.
