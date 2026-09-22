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

`--silent` sends `notify: false`, the field `MSG_SEND` has always carried as `true`. ⚠ **Only the
`true` side is measured.** The field's shape comes from a real request; what MAX does with `false`
has never been observed, because observing it means sending a message to somebody. So the flag is
offered and its effect is a claim about MAX, not a measurement — the first person to use it against
a real chat closes that, and until then it may be ignored at the other end.

## 7. The session is a token and a stable identity

| What | Where | Why |
|---|---|---|
| token | OS keyring, service `max-cli`, account = profile | it is the credential |
| `deviceId`, `viewerId`, login count | `<state dir>/profiles/<name>.json`, mode 0600 | identifying, and it must be **stable** |

**The device identity is written the first time it is read**, before it is used for anything.
Returning one without saving it looks harmless and is not: a failed login, or simply a second call,
would then present MAX a different device every time — which is exactly what §34 exists to
prevent. Found by a test.

### The token is replaced when it has gone stale, and kept

**MAX answers a login with a `token`, and it is a *new* one when the credential presented has
aged** — measured on the real account 2026-09-22 (`pnpm probe:token`, and a second run on a
scratch profile):

| logging in with | what came back |
|---|---|
| the token pasted in months earlier | a different one |
| that new token, immediately after | **the same one** |

So it is not a rotation on every login, and the keyring is not written on every command: the
replacement happens once, when the old credential is exchanged, and thereafter MAX hands the same
one back and nothing is written. The field was undeclared in the specification until then, so the
exchange happened on every login and the client threw the result away — a profile ran forever on
whatever was pasted in months earlier (`MAX-11`).

⚠ **The old token keeps working.** That is what the last months demonstrate: the pasted one went
on logging in while MAX offered a replacement each time. So this is a hygiene fix, not a repair of
something broken — which is also why the write is allowed to fail quietly.

`MaxClient.connect` writes it to the keyring, and three rules shape where:

- **After the account check, never before.** Somebody else's token reaches that point only if the
  check has already let it through. Persisting earlier would replace the owner's working
  credential with a stranger's, which is a worse version of the defect §7 above exists to fix.
- **A keyring that refuses does not fail the command.** The write can fail for reasons unrelated
  to what was asked — a locked keyring, no session bus — and the previous token still works. The
  reason goes to stderr; failing quietly is not failing invisibly (`NEED-97`).
- **`session start` no longer writes unconditionally.** It writes the pasted token only when the
  login left nothing better, because `connect` has usually just stored a fresher one.

⚠ **It is a credential and nothing prints it.** Not a diagnostic, not a fixture, not a length and
not a prefix. The only comparison made is against the token that was sent, and the only thing that
ever leaves is whether a write failed.

The write happens only when the value actually differs, so the cost is one keyring write the first
time a stale token is exchanged and none afterwards.

`MAX_TOKEN` is read before the keyring, which is how CI and the probes work without touching a real
keychain. `max session start` imports a session obtained elsewhere, asking for the token without echoing
it; the interactive phone-and-code
flow is not built yet.

### The login happens first, and the profile is bound to an account

⚠ **A token reaches the keyring only after MAX has accepted it** (`src/session/adopt.ts`). The
command used to write first, which meant a typo, an expired token or a browser tab that had been
closed replaced a *working* credential with a dead one — unrecoverably, because `Credentials.write`
overwrites unconditionally and a keyring entry cannot be read out again. The same shape destroyed
two working keys in `brazecli` on 2026-09-14, and `cli-core`'s `credentials.ts` says so in place.

Restoring the old token after a failed login was the alternative and is worse: a process killed
between the write and the restore leaves the profile broken. So `MaxClient.connect` takes a
candidate token, tries it, and stores nothing; `adoptToken` writes once there is something worth
writing. It sits beside `handshake.ts` rather than inside the command because `forCommand` builds
its own store and its own socket — anything left in a command action cannot be driven by a test.

⚠ **A profile remembers which account it is for, and refuses another one.** `viewerId` is written
from the first login onwards, and every later `connect` compares it with what LOGIN returns. A
mismatch is an `authentication_error` naming `max <profile> session end` — which is the deliberate
way to switch, since `forget()` clears the id along with the token. Silently accepting the other
account would mean `max <profile> messages send` speaking as somebody else, which is the first
constraint this project has.

The refusal is raised **before** the state is written, so an attempt that never became a session
neither counts towards the login total (`RISK-2`) nor moves `lastLoginAt`. Nothing is compared when
there is nothing to compare with: a profile created before this existed, or a login that returns no
profile, is accepted and never loses the id it already had.

Measured on the real account 2026-09-21, all three halves: **MAX returns the same account id on
every login** — three in a row against an id stored by the previous code, no refusal; a refused
login left an existing keyring entry byte-for-byte unchanged, against the OS keyring rather than
the in-memory one tests use; and a deliberately crossed id was refused with `stdout` empty and the
login count still at zero. The last two ran on a throwaway profile, so the owner's session was
never at risk.

### The login asks for a delta

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

**`src/session/handshake.ts` sends the stored marker in all four**, so only the first login of a
profile fetches everything. The marker lives in the cache database, one row (`sync_marker`), beside
the rows it describes — not in the profile's state file, because `max cache clear` has to forget
both in the same breath and a marker in another file would survive it.

⚠ **The marker and its rows are written in one transaction** (`src/cache/store.ts`, `mergeDelta`).
A marker saved over rows that failed to land makes the next login ask for changes since data
nobody has, and those people are then missing until something else happens to touch them. Nothing
downstream notices, which is why that case has a test of its own.

⚠ **A delta is mostly empty, and that is correct.** After the first login MAX sends only what
changed, so an absent person is an unchanged person. The store therefore merges and never deletes
on absence — with one exception, a chat's membership, which MAX restates in full whenever it sends
that chat at all. A command rendering the response instead of the store would show a full list once
and an empty one every time after.

⚠ **The login's `contacts` is a subset, not an address book**: 6 against 25 chats here, and six of
seventeen dialog partners when measured on 2026-09-19. A delta keeps that subset current; it does
not widen it.

All four markers take the same value harmlessly — measured the same day, with a week-old marker in
`presenceSync` and `draftsSync` as well: the answer was unchanged and the profile still arrived
(`NEED-103`).

`max contacts sync` forgets the marker so the next login takes the whole list again. It is a repair
tool for a store that drifted or a schema rebuild that emptied one — not the way contacts arrive,
because the delta rides on a login every command already performs. It is also the only thing that
could ever prune somebody MAX has stopped returning, since absence otherwise means unchanged.

### A chat carries its members, and we now ask who they are

`chat.participants` is an object **keyed by contact id**. `#partnerOf` returns `undefined` unless
exactly one of those ids is not ours — it still does, because naming a *dialog* needs to know which
single person is on the other side — but it is no longer what decides whom we look up. `#peopleFor`
takes every participant of every non-channel chat, which until 2026-09-20 meant a group of three
named nobody while its ids sat in our hands.

Measured 2026-09-20 on a real account: the chats the login returned held **23 distinct people**
while its `contacts` named **6**.

| kind | chats | participants listed | claimed |
|---|---|---|---|
| `DIALOG` | 17 | 33 | 33 |
| `CHAT` | 4 | 22 | 22 |
| `CHANNEL` | 4 | 4 | 178 011 |

**A group lists all of it; a channel does not**, and a channel's `participantsCount` is its
subscriber count — a membership nobody could enumerate and nobody wants as contacts. So naming
everyone in every group is one `CONTACT_INFO` over ids already in hand, batched at a hundred, and
**channels are skipped entirely**: storing four of a hundred and seventy-eight thousand subscribers
would be storing a wrong answer rather than a partial one.

The batch size is a choice, not a measurement. The comparable bound is `chatsCount`, where 100 is
accepted and 200 comes back out of range (`PROTO-3`); somebody in forty groups is the case that
will find the real number, and it will surface as a refusal that names itself.

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

### A listing answers one object, always the same one

```json
{ "items": [ … ], "page": 1, "limit": 20, "hasMore": true }
```

`chats list`, `contacts list` and `messages list` answer this in every machine mode — including
under `--all`, which answers `page: 1` and `hasMore: false`, and under `--offline`, which answers
out of the record. **The shape never says where the rows came from**; the exit code and the
diagnostics already do, and a caller that has to branch on which shape it got has gained nothing.

`hasMore` is a boolean and not a total. A pager asks whether to offer another page, and counting
rows MAX has not sent is a second question with a second cost. It is exact for chats and contacts,
which are counted in the store; ⚠ **for `messages list` it is a claim about the copy we hold**,
since history arrives in windows — a full page back is the only evidence there is that another one
exists.

A person still gets the table, and the line about another page goes to **stderr** as a note. It is
built by a helper each command calls (`src/commands/paging.ts`) rather than inside
`renderer.result`, because `account show` and `session start|end` are not listings and keep
answering a bare object.


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

### Paging, identical on every listing

| flag | means | default |
|---|---|---|
| `--limit <n>` | page size | `limit` from the settings, else 20 |
| `--page <n>` | which page, 1-based | 1 |
| `--all` | every row, no paging | off |

`--page` and `--all` together are a `validation_error`, not a silent winner. Both are resolved in
`resolveSettings` beside `limit` so no command re-derives the offset, and **neither gets a
configuration field**: a page number in a file is a setting nobody wants twice.

The paging happens in SQL — `LIMIT ? OFFSET ?` over the store — rather than by building the whole
list and slicing it, which is what stops being acceptable once the store is the authoritative copy.

⚠ **A page number over a live list can repeat or skip a row.** The order is most-recent-first, so a
message arriving between page one and page two pushes somebody across the boundary. Every CLI that
pages this way has this; it is in `--help` rather than engineered away.

**`messages list` is the exception and takes `--before`**, because MAX's history is already
anchored in time (`chats.history` takes `from`), so paging backwards through a conversation is
exact rather than approximate. It accepts a message id, and an ISO 8601 time when the id cannot be
resolved — a deleted message is exactly that case, being gone from the history MAX returns too.

⚠ A bare integer is **always** an id. A message id runs to eighteen digits and a millisecond
timestamp to thirteen, and telling them apart by size is a trap that fires the first time either
changes; requiring ISO 8601 for a time means the two can never be confused.

`contacts list` additionally takes `--order recent|name`, defaulting to `recent`. A flag and no
configuration field, deliberately: `--order` and a `contactOrder` setting would be two spellings of
one thing, which is what `--profile` was deleted for.

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

## 15. The store: people, and the chats they are in

The cache database (`<cache dir>/<profile>.db`, mode `0600`, `SCHEMA_VERSION` 2) is **a record and
an offline source, never a way to skip a request**. Every read still asks MAX, because the login
already returns the chats, the contacts and recent messages; `--offline` is the one mode that
answers from the record without connecting. There is no freshness window, and nothing here brings
one back — a stored person is valid until something says otherwise.

### A group member is a person, not a contact

The table is `people` — everyone MAX can name for us, whatever the reason — and `chat_members`
holds who is in what. **Being a contact is what the query asks for, not a column anybody
maintains** (`NEED-105`):

```sql
SELECT p.* FROM people p
  JOIN chat_members m ON m.person_id = p.id
  JOIN chats c        ON c.id = m.chat_id AND c.kind = 'dialog'
```

So a group member is present, joinable and never in `contacts list` — because they are outside the
set that query asks for, not because a flag hides them. That is what buys **"which groups do I
share with this person"** as one indexed lookup (`chatsWith`): every chat in the database is one
the owner is in, so the chats of a person *are* the shared set, with no self-join and no row for
ourselves.

The reading commands for that do not exist yet, on purpose. The data is stored so they can be
written the day somebody wants them; inventing the surface first is how a command nobody uses gets
maintained forever.

| column | why it is there |
|---|---|
| `last_messaged_at` | the default order. Stored rather than derived: recomputing a maximum per person on every listing is the work a store exists to avoid. Written on the same transaction as the rows it orders |
| `source` | how we met them — `login`, `info`, `participant`, `sync`. **Diagnostic**, never the filter |

Names merge with `coalesce`, not assignment. The same person arrives from the login, from
`CONTACT_INFO` and from a participant list, and not all of those carry a username or a description;
overwriting with what the latest one omitted would blank a name the store already had.

⚠ **`chat_members` is the one place that deletes**, and it is replaced per chat rather than
globally. MAX restates a chat's whole membership whenever it sends that chat, so a member missing
from it has left — while a *person* missing from a delta is merely unchanged, which after the first
login is every person we know. Clearing the table instead of the chat's rows would empty it on one
quiet login.

### A version bump is a rebuild, and that is a re-sync

`migrate` drops every table and creates them again, taking the names from `sqlite_master` rather
than from a list of what a previous version is thought to have written. Everything in here comes
back from MAX, so a column-by-column migration would be code that runs once, is tested never, and
is how the second schema change corrupts somebody's file. A file from a **newer** `max` is still
refused rather than written to.

The `fetched` row goes with the rest deliberately. Kept, it would claim a collection was complete
whose rows had just been thrown away — a lie the offline path believes.

⚠ **This stops being the right answer the day the store holds something MAX cannot re-send.**
Contacts that are in no chat at all would be exactly that (`RES-7`); the day they arrive, v2→v3
becomes `ALTER TABLE … ADD COLUMN` and this paragraph gets rewritten.

### It never fails the command

Nobody asked for the store, so a locked database or a full disk must not lose an answer MAX has
already given: `contacts list` falls back to what the login carried, and the reason goes to stderr
as a note. Failing quietly is right; failing *invisibly* is not — the cache was off on every
machine for a day because it swallowed its reason along with its failure (`NEED-97`).

What the fallback costs is the ordering and the paging, which the store does in SQL and an
in-memory slice does worse. What it does not cost is the answer.

## 16. Searching, and why it is FTS5 rather than `LIKE`

Three indexes — `chats_fts`, `people_fts`, `messages_fts` — over tables that already hold the
text. `content=` means FTS5 keeps the index and **not a second copy of the words**, reading the
columns back by rowid. The file does not double, and message bodies do not get a second home in
it.

⚠ **`LIKE`, `lower()` and `COLLATE NOCASE` fold case for ASCII only.** Measured 2026-09-22 on
SQLite 3.53.3: `LIKE '%иван%'` does not match `Иван Петров`, and neither do the other two. A name
search built on them silently misses half a Russian address book — silently being the whole
problem, since a short list reads as a complete one. FTS5's tokenizers fold case for any alphabet,
which is why this is FTS5 at all.

⚠ **`trigram`, not `unicode61`.** Measured the same day: `unicode61` matches whole words and
prefixes, so `етро` finds nothing; `trigram` matches inside a word and finds `Иван Петров`.
`chats.resolve` has always matched with `includes()`, so substring is the behaviour that was
already promised, and two name searches in one tool must not disagree.

Measured on both runtimes and identical: `node:sqlite` 3.53.3 and `bun:sqlite` 3.53.0 both ship
FTS5 with `trigram` and external content, with no flag and no rebuild.

### Three things that bite

**A trigram index cannot answer a query shorter than three characters**, and returns nothing
rather than failing. So the client refuses one — `checkedQuery` in `src/client.ts` — because an
empty list is indistinguishable from "no matches". It refuses on every path, including the one
where no cache opened and a JavaScript filter could have coped, so the answer never depends on
whether a cache happens to exist.

**What the person typed is data, not a query.** FTS5 reads its argument as an expression:
`O'Brien` is a syntax error, `a-b` is a column that does not exist, a lone `"` never terminates. A
chat named `O'Brien & Co` would take the command down with it. `phrase()` in `src/cache/store.ts`
wraps the input as one literal and doubles any quote inside; it is the only place a `MATCH`
argument is built.

**An external-content index does not follow its table.** Rename a chat with no trigger in place
and a search for the *old* title still matches the row, handing back the new name — nothing
errors, the index simply lies. SQLite also reuses a freed rowid, so a deleted chat can bequeath
its words to the next one. Hence triggers, and triggers rather than writes in TypeScript because
there are four write paths and forgetting one is invisible. They were verified against this
project's real statements — `INSERT … ON CONFLICT DO UPDATE`, with `people` resolving its columns
through `coalesce` — not against a plain `UPDATE` that the code never issues.

### Searching messages is the one read that never connects

MAX has no search operation in our registry, so there is nothing to send. `max messages search`
opens no socket and spends no login, which makes it the exact opposite of the rule every other
read follows (`df6792a`: the record does not answer a read).

⚠ **It therefore finds what has been read, not what exists.** A chat nobody has opened contributes
nothing and the answer has no way to know it. The command says so on stderr rather than leaving a
short list to be misread, and `--chat` takes an id rather than a name, because resolving a name
would need the chat list and the chat list would need the login this command promises not to spend.
