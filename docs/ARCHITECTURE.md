# Architecture

How this repository is put together and, more usefully, which seams you are not allowed to cross.

**Status 2026-09-20: this describes working code, not a plan.** Seven operations run against MAX
and two more commands answer from what is on this machine — `max cache` and `max runs`. Every
request sent is built from the specification in `src/spec/`, can be shown as it happens or kept
as a record (§13), and every setting is decided in one place (§14). Both runtimes pass.
Everything below was verified against the real service unless it says otherwise, and the round
trip was re-verified live on 2026-09-20 — `max chats list --limit 3 --verbose --record`, three
requests, stdout one JSON value and stderr carrying only the event lines. The brief is
[`REQUIREMENTS.md`](REQUIREMENTS.md); rulings are in
[`DECISIONS.md`](DECISIONS.md).

---

## 1. One published package, four layers, one direction

```text
     src/commands/     session · account · chats · contacts · messages · cache · runs
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
                        src/cache/     the record, behind a driver seam per runtime
                        src/runs/      one event per request · the run directory
```

⚠ **Correction 2026-09-20: the command names above were the pre-rename ones** — `login`, `me`,
`send`, `logout` — for a day after `NEED-48` renamed them. Every command is a resource and an
action now, and the diagram says what `max --help` says.

**Adding an operation, and what is generated from what: §12.**

Underneath all of it, [`@leemour/cli-core`](https://github.com/leemour/cli-core) supplies the
output streams, the renderer, the error model and exit codes, the keyring, config and clocks —
the half that has nothing to do with MAX and is shared with `braze-cli`.

**One package reaches npm** (`@leemour/max-cli`, command `max`) and the split inside it is by
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
| `runs/` | what a request cost, and where a record of it goes | what a request *said* — §13 |

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
specification supplies is the two payloads, so the field names have one home rather than two. What
it no longer owns is the socket: it is handed the client's `invoke`, so those two requests are
checked and reported like every other one (§13). The login
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

### The login can ask for a delta, and does not yet

`LOGIN` carries `chatsSync`, `contactsSync`, `presenceSync` and `draftsSync`. They are **moments in
time, not flags**: MAX returns only what changed in that collection since the one given, and the
response's own `time` is the marker to keep for next time.

Measured 2026-09-20 on a real account (`pnpm probe:contacts`):

| `contactsSync` / `chatsSync` | came back |
|---|---|
| `0` | 6 contacts, 25 chats — everything |
| the `time` the previous login answered with | 0 contacts, 0 chats |
| a week before that | 1 contact, 11 chats — a subset |

The third row is what makes this a measurement rather than a guess: "nothing came back for a
current marker" alone would equally support "any non-zero value suppresses the collection". The
profile is returned either way.

**`src/session/handshake.ts:38-41` sends `0` for all four**, so every command re-fetches every
chat and contact. Feeding the marker back is `MAX-10`, and it needs the marker and the rows written
in one transaction — a marker saved without its rows makes the next login ask for changes since
data that was never stored.

⚠ **The login's `contacts` is a subset, not an address book**: 6 against 25 chats here, and six of
seventeen dialog partners when measured on 2026-09-19. A delta keeps that subset current; it does
not widen it.

All four markers take the same value harmlessly — measured the same day, with a week-old marker in
`presenceSync` and `draftsSync` as well: the answer was unchanged and the profile still arrived.
Nothing reads presence or drafts, so they stay at `0` until something does.

### A chat carries its members, and nothing asks who they are

`chat.participants` is an object **keyed by contact id**, and `#partnerOf` (`src/client.ts:406`)
returns `undefined` unless exactly one of those ids is not ours. So a group of three names nobody,
and `MaxClient` drops ids it is already holding.

Measured 2026-09-20 on a real account: the chats the login returned held **23 distinct people**
while its `contacts` named **6**.

| kind | chats | participants listed | claimed |
|---|---|---|---|
| `DIALOG` | 17 | 33 | 33 |
| `CHAT` | 4 | 22 | 22 |
| `CHANNEL` | 4 | 4 | 178 011 |

**A group lists all of it; a channel does not**, and a channel's `participantsCount` is its
subscriber count — a membership nobody could enumerate and nobody wants as contacts. Naming
everyone in every group is therefore one `CONTACT_INFO` over ids already in hand, not a request
per chat. That is `MAX-10`.

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

## 13. One event per request, and the two places it can go

Every request is one object — direction, operation, opcode, `seq`, the ids the request named, how
long it took, how many bytes moved, how many things came back. **One object, two sinks**:
`--verbose` renders it on stderr as it happens, `--record` writes it to a file and shows nothing.
Either, both, or — by default — neither.

```text
→ session.login     op 19  seq 2  871 B
← session.login     op 19  seq 2  213ms  48.0 kB  25 chats  6 contacts
```

**What an event may never carry: a chat title, a person's name, a message body, a phone number or
a token** — not truncated and not hashed (§14, §24 of the brief). The ids are deliberately *in*:
an id is opaque and can only be correlated by whoever already holds the session, and every real
complaint is about one conversation. ⚠ The rule holds because `idsOf` in `src/runs/events.ts`
**builds the event from named fields rather than filtering a copy of the payload**. A filter lets a
field nobody has seen yet through by default; this cannot. `token` is a field of `session.login`
and there is no branch that reaches it. Pino's redaction underneath is the second line of defence.

### The hook is in the client, and the handshake goes through it

`MaxClient` takes an event sink the way it already takes `warn` — injected, so the client reports
what it did and never decides where that goes. It sits in `#send`, which builds the request,
times the round trip and checks the answer.

⚠ **`startSession` is handed the client's own `invoke` rather than the socket** (2026-09-20).
Until then it called `connection.invoke` directly, so INIT and LOGIN — the two requests *every*
invocation makes — bypassed all of it. `max chats list` answers out of the LOGIN response without
sending anything of its own, so a hook only in `#send` reported an empty run for a command that
had just logged in. It also means MAX's answer to LOGIN is now compared with the specification
like every other answer, and that immediately found a wrong declaration: `messages` is an object,
not an array (`PROTO-6`).

A request refused **before** the socket — a bad id, a field the strict request schema does not
know — emits no event, because nothing was sent. The run still records the outcome and the code.

**An answer that never left the machine gets an event of its own**, and it is deliberately not
shaped like a request: no opcode, no `seq`, no byte count, because calling a local answer "0 bytes
on the wire" would put a fiction in the record. It carries a `reason` instead — `offline`, meaning
the caller said never connect, or `history`, meaning the window asked for is older than a fetch
would return and the record is therefore authoritative rather than merely available. "We did not
ask" and "there was nothing to ask" are different events, and only the second is the local copy
doing its job.

### The run directory

Off unless asked for (`NEED-49`, `NEED-52`): `--record` for one invocation, `--no-record` to
refuse it, and neither means the configuration file decides. A messenger tool that silently
accumulates a directory per command is a record of somebody's life that nobody asked to keep.

```text
<state dir>/runs/2026-09-19/20260919T233522Z-chats-list-8a0f17/
  run.json       0600 — what it was, when, which profile, how long, the outcome, the error code
  events.jsonl   0600 — one JSON object per request, written by Pino, no ANSI ever
```

Directory `0700`, both files `0600`, `run.json` written atomically and **twice** — once as the run
starts, saying `running`, and once by `finish`. A directory holding events and no metadata would be
a special case `max runs list` had to carry forever. `finish` runs on every path, including a
command that failed before the connection was open, and it awaits the logger: Pino appends through
a plain stream, and a process that exits first loses the tail — which is exactly the run somebody
wanted to read.

The day directory is UTC, so a run at 01:35 in Madrid lands under the previous day.

**Files, not the SQLite cache** (`NEED-51`): opposite lifecycles, and two `max` invocations run at
once here. Two appends to two files never conflict; two writers on one database take a lock, and a
diagnostic that can fail the command it was describing is worse than no diagnostic.

**Retention is 30 days, pruned as a recorded run starts** — a whole day at a time, by the
directory name, so nothing has to be opened to decide. A tool that is not recording never walks
that directory.

`max runs list`, `max runs show <id>` and `max runs path <id>` read them back. An empty list says
why it is empty and names `--record`, on stderr — stdout still carries one JSON value.

**`runs path` is no exception to that** (`NEED-88`): it answers `{"path": "…"}`, so a script reads
`max runs path <id> --json | jq -r .path` and a terminal gets the bare path on a labelled line. The
convenience of `cat "$(max runs path <id>)/events.jsonl"` was not worth a contract with an
exception in it — the rule that holds everywhere is the one nobody has to remember.

## 14. Settings, and the order one is decided in

**Flag, then environment, then the configuration file, then the built-in default.** Decided once,
in `resolveSettings` (`src/config.ts:79`), and every command takes what it is given — a command
that re-derived the order would be the one that disagrees.

| | how the profile is said |
|---|---|
| command line | `max personal chats list` — the first word |
| environment | `MAX_PROFILE=personal` |
| configuration file | `"defaultProfile": "personal"` |
| built-in | `default` |

### The profile is the first word, not a flag

`--profile` was deleted (`NEED-45`). The first word is the profile **unless it names a command**,
so `max chats list` and `max personal chats list` both work and neither needs a flag
(`src/profile.ts:45`). The word has to come first, before any option: `max --json personal chats`
reads `personal` as a command and fails.

⚠ **A profile named after a command could never be selected**, because `max chats` has to mean the
command. `max session start` refuses such a name (`src/profile.ts:57`) — creation is the only
moment the collision can still be explained. A name also becomes a file name and a keyring
account, so it is letters, digits, dot, dash and underscore, and nothing else.

A first word that is neither a command nor a profile anyone has logged in under gets the ordinary
`authentication_error`, naming the profile and carrying it into the fix — `max x session start`,
not `max session start`, which would log the wrong profile in. `max chat list`, one letter short
of `chats`, is the everyday version of this, and the message says which word was read as what.

### The file

`~/.config/max-cli/config.json` (`$XDG_CONFIG_HOME`, or the OS convention elsewhere), mode `0644`,
read through `cli-core`'s `loadConfigFile`.

```json
{
  "defaultProfile": "default",
  "profiles": {
    "default": { "limit": 20, "timeoutMs": 30000, "color": true, "record": false, "keepRunsForDays": 30 }
  }
}
```

**A missing file is not an error** — it is a program nobody has configured. A malformed one is, in
every output mode, and it names the field: the schema is `strictObject`, so `"limitt"` reports
`profiles.default.limitt` instead of being dropped (`src/config.ts:22`). Valibot's plain `object()`
silently discards what it does not recognise, which would turn a typo into a setting that appears
to be ignored for no reason. This is the **opposite** of the rule for MAX's own answers, where an
unknown field is kept on purpose (`NEED-35`).

**No field in the schema could hold a secret** — no token, no phone number, no chat id. Nowhere to
put one is stronger than a rule saying do not.

`limit` is one number for every command that takes `--limit`, including `contacts list`, which
used to show everything. `timeoutMs` unset means the transport's own 30 seconds
(`src/protocol/connection.ts:57`); `color` unset means "decide from the terminal".

### Two things that jump the queue

**`MAX_TOKEN` outranks the keyring** — `cli-core`'s `Credentials.read`. Deliberate: it is how a
token is handed to a container or a probe without being stored.

⚠ **`MAX_CONFIG_DIR`, `MAX_STATE_DIR` and `MAX_CACHE_DIR` change which keyring entry a profile
means.** `pathsAreOverridden` makes the service `max-cli:<configDir>` instead of `max-cli`, so a
login performed under those variables is invisible to a command run without them, and that command
answers "no session" for a profile that plainly exists. Use the same environment for both, or
neither. This has already cost an afternoon (`UX-1`).

### Diagnostics all leave by one door

`--quiet` silences everything diagnostic and nothing else: a failure still prints, because an exit
code says which kind of thing went wrong and nothing about which chat (`src/output.ts:40`).

That works because there is exactly one place a `MaxClient` is built
(`src/commands/context.ts:23`) and it hands the client the renderer's `note`. The protocol note
used to go straight to stderr from inside the client, past the renderer, so `--quiet` did not
silence it and `--json` did not shape it (`BUG-7`). Six commands each remembering to pass a `warn`
is a rule that gets broken once and is then invisible; one construction site is not.
