# Architecture

How this repository is put together and, more usefully, which seams you are not allowed to cross.

**Status 2026-09-19: this describes working code, not a plan.** Six commands run against MAX;
1 986 lines of TypeScript, 57 tests. Everything below was verified against the real service unless
it says otherwise. The brief is [`REQUIREMENTS.md`](REQUIREMENTS.md); rulings are in
[`DECISIONS.md`](DECISIONS.md).

---

## 1. One published package, four layers, one direction

```text
     src/commands/     login · me · chats · contacts · messages · send · logout
            │          speaks the domain model, owns no protocol knowledge
            ▼
     src/client.ts     MaxClient — the only thing above here that knows MAX exists
            │
    ┌───────┴────────────────────────┐
    ▼                                ▼
 src/domain/                   src/protocol/
 Chat · Message · Contact       frame codec · connection · session
 mapping from wire shapes       seq correlation · INIT → LOGIN
```

Underneath all of it, [`@cli-heaven/cli-core`](https://github.com/CLI-Heaven/cli-core) supplies the
output streams, the renderer, the error model and exit codes, the keyring, config and clocks —
the half that has nothing to do with MAX and is shared with `braze-cli`.

**One package reaches npm** (`@cli-heaven/max-cli`, command `max`) and the split inside it is by
directory, not by workspace (`NEED-12`). The rule that the package boundary used to enforce is now
a lint rule: **`src/commands/` may not import from `src/protocol/`** — Biome fails the build, with
that sentence as the message. Verified by writing the forbidden import and watching it go red.

## 2. What each layer may know

| Layer | Knows about | Must never |
|---|---|---|
| `commands/` | `Chat`, `Message`, `Contact`, the renderer, exit codes | opcodes, frames, `ws`, MAX field names |
| `client.ts` | opcodes, the session, the domain model | rendering, `process.stdout`, argv |
| `domain/` | MAX's wire shapes, and only to translate them out | the network, the session |
| `protocol/` | frames, seq, the socket | who is asking or why |
| `session/` | the keyring, the state file | anything it can ask `cli-core` for |

The point of the seam is replaceability: if MAX's transport changes, `protocol/` and `client.ts`
change and nothing above them notices. That was the whole argument for writing our own adapter
rather than depending on `@bruch/max-client` (`NEED-17`).

## 3. The WebSocket is JSON, and ids are the reason to be careful

MAX's web protocol is text frames of `{ver: 11, cmd, seq, opcode, payload}`, where `cmd` is
0 request, 1 response, 3 error. MessagePack, LZ4 and zstd belong to the **TCP** transport, which we
do not use.

⚠ **Never `JSON.parse` a MAX frame.** Chat and message ids are 64-bit. Measured on a real account:
message ids come back with **18 digits**, past `Number.MAX_SAFE_INTEGER`, so the built-in parser
rounds them and two different messages can arrive as one id. `src/protocol/frame.ts` parses with
`lossless-json`, hands back a `bigint` for anything that would not survive, and **every id leaves
that layer as a string** — an id is an identifier, never arithmetic.

`seq` is the only thing tying an answer to its question: MAX interleaves pushed events with
responses on one socket, so a reader that takes the next frame as its answer eventually reads
somebody's incoming message instead.

## 4. One command, one connection, and it closes

Every command follows `connect → do the thing → print → close`, with the close in a `finally`.
`Connection` owns the socket, the per-request timers and the listeners, and `close()` clears all
three. **A command that prints its result and then hangs is a defect**: an open WebSocket or a live
timer keeps Node alive, and a script that pipes `max chats --json` would never return.

`INIT` (6) then `LOGIN` (19) precede everything — MAX answers nothing before them. The login
response is unusually generous: profile, chats, contacts, recent messages and presence all arrive
with it, so `max me` and `max chats` need **no further request**. This is why `PROFILE` (16) is not
used to read a profile: it is a profile *update* and refuses an empty payload.

`interactive: false` on login and on history. The web client sends `true` because a person is
looking at it; we are a script reading, and whether that flag moves presence or read state is not
settled (`RES-5`).

## 5. Reading is observational, by construction

`CHAT_HISTORY` (49) and `CHAT_MARK` (50) are separate operations. We simply never send 50, and
`src/client.test.ts` asserts that opcode 50 is absent from everything the client sent — so "reading
does not mark messages read" is a test rather than a promise.

The one thing not proven: whether `LOGIN` itself moves presence. That needs a second device
watching, and until then it is an open question, not a settled one.

## 6. A send may be retried, and only because it was measured

Braze's rule was "never retry a write". MAX earns a different one: **`MSG_SEND` carries a
client-generated `cid`, and MAX deduplicates by it.** Measured 2026-09-19 in the Saved-messages
dialog — the same `cid` sent twice returned the **same message id** and left **one** copy, and it
held across two separate connections and logins, which is the case a retry actually faces.

So a lost send is retried **once, with the same `cid`**, never a fresh one. If the retry also
fails, the answer is `outcome_unknown` — never failed, never sent — and it names the `cid`, so
`max send --cid <n>` repeats the attempt without risking a second copy.

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
keychain. `max login --token` imports a session obtained elsewhere; the interactive phone-and-code
flow is not built yet.

## 8. We look like the official client

Nothing on the wire names this tool (§34). `WEB_USER_AGENT` in `src/protocol/session.ts` is the web
client's shape, the `Origin` header is `https://web.max.ru`, and the device identity is stable per
profile. That is also why `ws` is used rather than Node's built-in `WebSocket`: measured on both
runtimes, `ws` sends custom headers identically, and the built-in's support depends on the bundled
undici version.

## 9. A name is never resolved by guessing

`max messages "Ivan"` matches chat titles — exactly first, then as a fragment. **An ambiguous name
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
