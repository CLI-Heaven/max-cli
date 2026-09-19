# Architecture

How this repository is put together and, more usefully, which seams you are not allowed to cross.

**Status 2026-09-19: this describes working code, not a plan.** Seven commands run against MAX,
and every request they send is now built from the specification in `src/spec/`; 78 tests.
Everything below was verified against the real service unless it says otherwise. ⚠ The one thing
not re-verified live since the specification landed is the round trip itself — the suite and both
runtimes pass, and the commands have not been run against MAX again. The brief is [`REQUIREMENTS.md`](REQUIREMENTS.md); rulings are in
[`DECISIONS.md`](DECISIONS.md).

---

## 1. One published package, four layers, one direction

```text
     src/commands/     login · me · chats · contacts · messages · send · logout
            │          speaks the domain model, owns no protocol knowledge
            ▼
     src/client.ts     MaxClient — the only thing above here that knows MAX exists
            │          client.chats.list() · client.messages.send() · client.account.me()
    ┌───────┼────────────────┬──────────────────┐
    ▼       ▼                ▼                  ▼
 src/domain/  src/spec/          src/generated/    src/protocol/
 Chat         one operation,     opcode registry   frame codec
 Message      declared once      operation table   connection
 Contact      Valibot schemas    wire wrappers     seq correlation
 mapping      provenance         never hand-edited
                                         ▲
                        src/session/   handshake (INIT → LOGIN) · keyring · state
```

**Adding an operation, and what is generated from what: §12.**

Underneath all of it, [`@cli-heaven/cli-core`](https://github.com/CLI-Heaven/cli-core) supplies the
output streams, the renderer, the error model and exit codes, the keyring, config and clocks —
the half that has nothing to do with MAX and is shared with `braze-cli`.

**One package reaches npm** (`@cli-heaven/max-cli`, command `max`) and the split inside it is by
directory, not by workspace (`NEED-12`). The rule that the package boundary used to enforce is now
a lint rule: **`src/commands/` may not import from `src/protocol/`, `src/spec/` or
`src/generated/`** — Biome fails the build, with that sentence as the message. Verified by writing
the forbidden import and watching it go red, once for each direction.

## 2. What each layer may know

| Layer | Knows about | Must never |
|---|---|---|
| `commands/` | `Chat`, `Message`, `Contact`, the renderer, exit codes | opcodes, frames, `ws`, MAX field names |
| `client.ts` | opcodes, the session, the domain model | rendering, `process.stdout`, argv |
| `domain/` | MAX's wire shapes, and only to translate them out | the network, the session |
| `spec/` | every operation, its shape and where it came from | the socket, the session, output |
| `generated/` | what follows from `spec/` | being edited by hand |
| `protocol/` | frames, seq, the socket | who is asking or why — **including the handshake** |
| `session/` | the keyring, the state file, INIT → LOGIN | anything it can ask `cli-core` for |

The point of the seam is replaceability: if MAX's transport changes, `protocol/` and `client.ts`
change and nothing above them notices. That was the whole argument for writing our own adapter
rather than depending on `@bruch/max-client` (`NEED-17`).

## 3. The WebSocket is JSON, and ids are the reason to be careful

MAX's web protocol is text frames of `{ver: 11, cmd, seq, opcode, payload}`, where `cmd` is
0 request, 1 response, 3 error. MessagePack, LZ4 and zstd belong to the **TCP** transport, which we
do not use.

⚠ **Never `JSON.parse` a MAX frame.** Ids are 64-bit. Measured on a real account: message ids come
back with **18 digits**, past `Number.MAX_SAFE_INTEGER`, so the built-in parser rounds them and two
different messages can arrive as one id.

Measured again 2026-09-19, over 25 chats and 6 contacts (`pnpm probe:ids`): **chat ids reach 14
digits and contact ids 9** — every one of them inside what a number holds. So the ids we *send*
have never been long enough to be damaged, and the ids we *read* are the ones that need the
lossless codec. Chat ids being 19 digits was an illustration that had found its way into the code
as if it were a measurement; corrected in `src/protocol/frame.ts`. `src/protocol/frame.ts` parses with
`lossless-json`, hands back a `bigint` for anything that would not survive, and **every id leaves
that layer as a string** — an id is an identifier, never arithmetic.

`seq` is the only thing tying an answer to its question: MAX interleaves pushed events with
responses on one socket, so a reader that takes the next frame as its answer eventually reads
somebody's incoming message instead.

## 4. One command, one connection, and it closes

Every command follows `connect → do the thing → print → close`, with the close in a `finally`.
`Connection` owns the socket, the per-request timers and the listeners, and `close()` clears all
three. **A command that prints its result and then hangs is a defect**: an open WebSocket or a live
timer keeps Node alive, and a script that pipes `max chats list --json` would never return.

`INIT` (6) then `LOGIN` (19) precede everything — MAX answers nothing before them. The handshake
is handwritten in `src/session/handshake.ts` and will stay that way (§9 of the brief); what the
specification supplies is the two payloads, so the field names have one home rather than two. The login
response is unusually generous: profile, chats, contacts, recent messages and presence all arrive
with it, so `max account show` and `max chats list` need **no further request**. This is why `PROFILE` (16) is not
used to read a profile: it is a profile *update* and refuses an empty payload.

`interactive: false` on login and on history. The web client sends `true` because a person is
looking at it; we are a script reading, and whether that flag moves presence or read state is not
settled (`RES-5`).

## 5. Reading is observational, by construction

`CHAT_HISTORY` (49) and `CHAT_MARK` (50) are separate operations. We simply never send 50, and
`src/client.test.ts` asserts that opcode 50 is absent from everything the client sent.

⚠ **Correction 2026-09-19: that assertion was empty until the specification landed.** It compared
against `Opcode.CHAT_MARK`, and no such constant existed — so it read `not.toContain(undefined)`
and passed whatever the client had sent. Nothing caught it because `tsconfig.json` excludes test
files from type checking (`OPS-8`). 50 is now a declared opcode with the reason it is never sent,
so the assertion compares against a real number.

The one thing not proven: whether `LOGIN` itself moves presence. That needs a second device
watching, and until then it is an open question, not a settled one.

## 6. A send may be retried, and only because it was measured

Braze's rule was "never retry a write". MAX earns a different one: **`MSG_SEND` carries a
client-generated `cid`, and MAX deduplicates by it.** Measured 2026-09-19 in the Saved-messages
dialog — the same `cid` sent twice returned the **same message id** and left **one** copy, and it
held across two separate connections and logins, which is the case a retry actually faces.

So a lost send is retried **once, with the same `cid`**, never a fresh one. If the retry also
fails, the answer is `outcome_unknown` — never failed, never sent — and it names the `cid`, so
`max messages send --cid <n>` repeats the attempt without risking a second copy.

⚠ Unmeasured: how long MAX remembers a `cid`. Both probes were seconds apart.

`cid` generation is monotonic within a process. `Date.now()` alone gave two sends in the same
millisecond the same number, which — given the deduplication above — would have made the second
message vanish silently. A test caught that; a lost message was the alternative.

## 7. The session is a token and a stable identity

| What | Where | Why |
|---|---|---|
| token | OS keyring, service `max-cli`, account = profile | it is the credential |
| `deviceId`, `viewerId`, login count | `<state dir>/profiles/<name>.json`, mode 0600 | identifying, and it must be **stable** |

**The device identity is written the first time it is read**, before it is used for anything.
Returning one without saving it looks harmless and is not: a failed login, or simply a second call,
would then present MAX a different device every time — which is exactly what §34 exists to
prevent. Found by a test.

`MAX_TOKEN` is read before the keyring, which is how CI and the probes work without touching a real
keychain. `max session start` imports a session obtained elsewhere, asking for the token without echoing
it; the interactive phone-and-code
flow is not built yet.

## 8. We look like the official client

Nothing on the wire names this tool (§34). `WEB_USER_AGENT` in `src/spec/identity.ts` is the web
client's shape, the `Origin` header is `https://web.max.ru`, and the device identity is stable per
profile. That is also why `ws` is used rather than Node's built-in `WebSocket`: measured on both
runtimes, `ws` sends custom headers identically, and the built-in's support depends on the bundled
undici version.

## 9. A name is never resolved by guessing

`max messages list "Ivan"` matches chat titles — exactly first, then as a fragment. **An ambiguous name
is an error listing the candidates, not a choice.** Sending to the wrong conversation does not
undo. Verified live, where a full contact name matched two chats and the command stopped.

A one-to-one chat has no title of its own, so the partner's name is filled in from contacts: one
`CONTACT_INFO` (32) for every unknown partner at once. Measured: the login carried 6 contacts
against 17 dialog partners, and naming took 0 of 17 dialogs to 16 of 17.

⚠ Opcode 36 is `CONTACT_LIST` in tsmax and PyMax, and `GET_BLOCKED` in the protocol documentation.
**Not used.** "Your contacts" and "people you blocked" is not a difference to discover in
production.

## 10. Output: stdout is data, stderr is everything else

`--json`, or any non-terminal stdout, means **one JSON value on stdout and nothing else** — no
spinner, no `✓`, no warning, no ANSI. Diagnostics go to stderr in every mode, including the pretty
one, so the contract holds by construction rather than by remembering. Verified on a live command:
stdout parsed as a single JSON value, stderr empty.

A failure never reaches stdout either. `run()` returns an exit code rather than throwing; the error
goes to stderr as JSON when piped and as a sentence in a terminal, and the code comes from
`cli-core`'s table — `4` for an authentication problem, `130` for an interrupt. A script branches on
that, never on text.

## 11. Trade-off order

When two of these conflict, the earlier one wins:

```text
correctness > not touching someone's account by accident > auditability
> agent determinism > human UX > protocol coverage > implementation cleverness
```

"Not touching someone's account by accident" sits that high because this runs against a real
personal account: an unwanted send, an accidental read receipt or a message deleted by a retry are
not test failures, they are things that happened to a person.

## 12. One operation, declared once

Every opcode and every payload shape lives in `src/spec/`, as ordinary TypeScript whose Valibot
schemas **are** the definition rather than a copy of it (`NEED-7`). `src/generated/` holds what
follows from that and is never edited by hand.

| Generated, committed, checked in CI | Handwritten, and staying that way |
|---|---|
| `src/generated/opcodes.generated.ts` — the registry | the socket, `seq` correlation, timeouts |
| `src/generated/operations.generated.ts` — the table | the INIT → LOGIN handshake |
| `src/generated/client.generated.ts` — wire wrappers | the schemas themselves — they are the spec |
| [`protocol.md`](protocol.md) — the reference page | the domain mapping, and error classification |

### Adding one

1. Write it in `src/spec/operations/<subject>.ts` with `defineOperation`: a dotted `name`, MAX's
   own `constant`, the opcode, a **strict** request shape, a **loose** response shape, and where
   the shape came from.
2. `pnpm generate`. A duplicate opcode, a duplicate name or a dotted name that is not
   `<group>.<method>` stops it with a sentence naming both sides.
3. Call it from `MaxClient`. The generated wrapper is typed from the schema and stays internal.

**A number you know and will not send gets `reserveOpcode` instead**, with the reason in the entry.
It reaches the registry and never gets a method, which is what makes "do not call an opcode because
it is in the enum" a property of the code rather than a rule to remember.

### Two directions, two schemas

**Requests are strict**: a field nobody has seen is refused before it reaches the socket.
**Responses are loose**: a field MAX adds passes through untouched, every field we do not depend on
is optional, and nothing about a response can fail a command (§29 of the brief, `NEED-35`).

Every answer is still compared with what we declared, and a mismatch is **one line on stderr** — a
field we rely on that stopped being what it was is worth hearing about, and the failure being
prevented is the quiet one where a renamed field turns a column into blanks.

⚠ **That note is assembled by hand from the field path and the expected type.** Valibot's own
message quotes the value it saw, and the value may be somebody's message (§14, §24). A test asserts
a message body never appears in a note.

### An id is a string above the codec and a `bigint` on the wire

`asId` reads; `id()` in `src/spec/scalars.ts` writes. Before the specification there was no write
direction and `Number(chatId)` stood in for it, which silently rounds anything past 15 digits —
`Number("7268926000000000001")` is a different chat. Ids below 2⁵³ produce the identical bytes they
did before, so the repair is invisible except where it matters.

**It never mattered yet.** Measured 2026-09-19 across every chat and contact the login returned:
nothing past 2⁵³, the longest chat id 14 digits. The old conversion was not damaging anything — the
two things we send ids for, chats and contacts, both stay small. This is hardening, and it stops
the question being re-asked every time somebody reads `Number(chatId)` and wonders.

### Staleness

`pnpm generate` writes the files and formats them in the same step, then CI regenerates and asserts
the tree did not change (`OPS-3`). The banner carries no date and no version: anything that moves
on its own turns that check into a permanent failure.
