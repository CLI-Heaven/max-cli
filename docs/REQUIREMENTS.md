# MAX CLI — requirements

The brief this repository is built against, recorded from the owner's specification
(2026-09-18). **It is the source, not a summary.** Where a decision here has since been settled
or overturned, the ruling lives in [`DECISIONS.md`](DECISIONS.md) and that file wins; a
superseded paragraph below is marked, never deleted.

Section numbers are permanent addresses — other documents cite `REQUIREMENTS.md §11`. A section
added later is appended, never inserted.

How the work is cut up: [`BACKLOG.md`](BACKLOG.md). How it is built:
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Remaining questions

None of these block writing the architecture proposal; all of them block hardening code or
examples around an answer.

1. **Which MAX client or transport** — §5, options A–D. The architecture proposal recommends our
   own WebSocket adapter; the recommendation is not yet ruled.
2. **How many profiles, and named what.** §13 asks for named profiles "if this comes almost for
   free". Whether the first release ships more than `default` is open.

**A question here keeps its `NEED-nn` number once it is answered**, and the answer goes to
[`DECISIONS.md`](DECISIONS.md) under that same number. Cite the number, never the position in this
list: the list shrinks as questions are answered, so "question 5" points at something else a month
from now.

---

## 1. Approach

Build a CLI for MAX Messenger, based heavily on the existing `../braze-cli` project.

Start by thoroughly inspecting `../braze-cli`. **Do NOT start a fresh project from scratch.**

The preferred approach is:

1. copy/reuse the existing Braze CLI project structure and tooling;
2. extract the genuinely vendor-independent parts into a reusable `cli-core` package;
3. remove Braze-specific functionality;
4. build MAX-specific functionality on top using the same architectural principles and developer
   experience;
5. preserve the things that already work well in Braze CLI rather than reinventing them.

The MAX CLI should ultimately feel like a sibling of `braze-cli`.

## 2. Context — what to retain from Braze CLI

The existing Braze CLI already contains useful infrastructure and design decisions to retain
where they make sense:

* TypeScript
* pnpm
* Commander-style CLI architecture
* Valibot for runtime validation
* Pino-based structured logging
* pretty TTY output
* colors enabled by default
* machine-readable `--json` output
* clean separation between core logic and CLI/UI concerns
* credentials via OS keyring first, with a secure file fallback
* configurable timeouts
* retry/backoff/jitter infrastructure
* dry-run infrastructure where meaningful
* run/audit infrastructure
* generated API surface where practical
* generated files committed to the repository
* handwritten overrides/extensions where generation is insufficient
* good testability
* minimal coupling to Node-specific APIs in reusable core code where practical

**Inspect the real code before deciding exactly which abstractions to preserve.**

There is currently a virtual/internal `braze-core` package or layer inside that project.
Investigate whether the vendor-neutral parts should be extracted into something like `cli-core`.

**Do not blindly rename `braze-core` to `cli-core`.** Separate generic infrastructure from
Braze-specific concepts properly.

Likely generic:

* command execution primitives
* output formatting
* JSON output contract
* terminal UI
* error model
* config loading
* credential abstraction
* logging
* retry primitives
* pagination helpers
* filesystem helpers
* run/audit helpers
* test utilities

Likely **not** generic:

* Braze endpoint concepts
* Braze authentication headers
* Braze REST models
* Braze rate-limit semantics
* Braze Postman generation
* Braze-specific environment assumptions

The goal is to end up with reusable foundations rather than a MAX project containing renamed
Braze concepts.

## 3. Product goal

A local CLI for the owner's **normal personal MAX Messenger account**.

This is NOT initially a userbot, a daemon, a bridge, a monitoring service, a realtime listener, a
bulk messaging system or a bot-account client.

The primary interaction model is:

```text
connect → execute one operation → print result → cleanly disconnect/exit
```

Examples:

```sh
max login
max me
max chats
max messages <chat>
max send <chat> "Hello"
max logout
```

Every useful data-oriented command supports JSON output:

```sh
max chats --json
max messages 123456 --limit 20 --json
max send 123456 "Hello" --json
```

JSON mode matters because this CLI must be callable reliably from shell scripts, Claude Code,
other AI agents and future MCP tooling. In JSON mode:

* stdout contains ONLY valid machine-readable JSON;
* diagnostics/logging must not pollute stdout;
* logs and errors belong on stderr;
* output schemas are stable and versionable.

Human output stays pleasant and concise, similar to `braze-cli`.

## 4. Important MAX distinction

**Do not use the official MAX Bot API.** What is needed is the API/protocol used by a normal MAX
user account.

Existing research found several relevant projects. **Inspect their CURRENT source code rather
than trusting README claims.**

Priority references:

* `MaxApiTeam/PyMax`
* `renosaza/max-mcp`
* `sibstark/tsmax` / npm `@bruch/max-client`
* `sansmaster1982/maxim-messenger`
* `blackyblack/maxrs`
* `eizemazal/avenarius`
* `pr0bel1230/max-api-docs`
* `Aist/max2tg`
* `nsdkinx/vkmax`
* `huxuxuya/python-max-client`
* `rast-games/pyromax`
* `mochensky/max-user-api`

Previous findings that **must be verified against current code**:

* PyMax appears to have both native TCP and WebSocket client paths.
* `renosaza/max-mcp` appears to expose ordinary MAX user functionality to Claude Code and uses
  `maxapi-python`.
* `@bruch/max-client` is particularly interesting because it is TypeScript and reportedly
  supports the native MAX protocol, SMS/2FA/QR login, sessions, chats and messages.
* `maxim-messenger` contains an actual standalone CLI implementation.
* `maxrs` contains a CLI example.
* Avenarius contains another native protocol implementation.
* MAX native transport has been reverse engineered as TLS/TCP with framed MessagePack payloads
  and compression.
* WebSocket is also used by MAX Web.

WebSocket itself is not a problem. What is not needed is a permanently connected realtime
process. Opening a WebSocket, performing one request/response operation and closing it is
completely acceptable.

## 5. First architectural decision

Before writing substantial MAX-specific code, determine which implementation strategy makes most
sense with the existing Braze CLI technology stack. Compare at least:

| | |
|---|---|
| **A** | TypeScript CLI using an existing TypeScript MAX library such as `@bruch/max-client` |
| **B** | TypeScript CLI with a small native protocol adapter implemented by us, using the existing independent protocol implementations as references |
| **C** | TypeScript CLI delegating MAX protocol handling to PyMax somehow |
| **D** | Reusing/adapting an existing CLI implementation such as `maxim_cli.dart` or `maxrs` |

Keeping the application in the same TypeScript ecosystem as `braze-cli` is strongly preferred, so
an existing TypeScript client is attractive if its quality is sufficient — **but do not choose it
merely because it is TypeScript.**

Assess: implementation quality · protocol coverage · maintenance activity · authentication
reliability · session handling · 2FA support · QR support · clean one-shot execution ·
dependency quality · Bun-only vs Node compatibility · portability · whether it exposes
unnecessary userbot/realtime assumptions · how difficult it would be to replace later.

We should own as little reverse-engineered protocol code as practical. At the same time, isolate
the MAX dependency behind our own small interface so changing libraries later is
straightforward.

## 6. Architecture

Conceptually:

```text
cli-core
   ↓
max-core
   ↓
MAX adapter / transport
   ↓
generated protocol/API layer where appropriate
```

and:

```text
max CLI
   ↓
max-core
```

Potentially later:

```text
MAX MCP server
   ↓
max-core
```

**Do NOT make the MCP server the core architecture.** The CLI and a future MCP server are sibling
adapters over the same `max-core`:

```text
            max CLI
               │
               ▼
            max-core
               │
               ▼
       MAX client adapter
          /         \
  generated API   transport/session
```

MAX-specific behaviour stays out of `cli-core`.

## 7. Spec-first / code generation

Braze CLI benefits from an official Postman collection that can be transformed into code. MAX has
no equivalent authoritative public Postman collection for the normal user protocol. A spec-first
approach is still wanted.

When MAX changes something, the maintenance workflow should ideally be:

1. update our protocol/API specification;
2. regenerate;
3. update only small handwritten transport/adaptation code where necessary;
4. run tests.

**Do NOT use OpenAPI merely because it is familiar.** The MAX user protocol is not fundamentally
a REST/HTTP API, and forcing numeric opcodes, request/response frames, WebSocket messages, TCP
messages and session behaviour into OpenAPI would create the wrong abstraction.

The preferred direction is to investigate **TypeSpec** as the source-of-truth specification,
because it gives a proper typed schema language, is suitable as an API source of truth, supports
custom emitters, can also emit JSON Schema, can represent MAX-specific operation metadata through
our own decorators/extensions, and the generator can live in the same TypeScript repository.
Investigate this seriously before falling back to a custom YAML format.

A possible shape might conceptually be `spec/max.tsp`, containing: models · enums · request
payloads · response payloads · operation names · opcode/message identifiers · authentication
requirements · request/response relationship · transport applicability · pagination metadata where
known · optional protocol version constraints · notes about undocumented/unknown fields.

Potential MAX-specific metadata might conceptually include `@opcode(...)`,
`@responseOpcode(...)`, `@authRequired`, `@transport(...)`, `@paginated(...)`. **These exact
decorators are only examples.** Design the smallest sensible model. Do not overdesign a general
networking IDL — this is a MAX protocol spec for our needs.

## 8. What should be generated

**Do NOT try to generate absolutely everything.** The generator handles repetitive, declarative
pieces. Good candidates:

* TypeScript request/response types
* operation names
* opcode constants/registry
* operation metadata
* runtime payload validators
* Valibot schemas if reasonably generated
* typed `invoke()` wrappers / client method scaffolding
* CLI operation metadata where useful
* protocol documentation/reference tables
* fixture/schema validation
* coverage report showing documented vs implemented operations

Conceptually: `client.chats.list(...)`, `client.messages.list(...)`, `client.messages.send(...)`,
`client.account.me()` — with stable typed inputs and outputs.

Generated code is clearly marked as generated, is not manually modified, is deterministic, and is
committed to git. CI must be able to detect stale generated output — conceptually `pnpm generate`
followed by checking that the working tree did not change.

## 9. What should NOT be generated

Protocol mechanics stay handwritten: socket lifecycle · TLS setup · WebSocket setup · frame
encoding/decoding · MessagePack encoding · compression · sequence numbers · request correlation ·
authentication state machine · reconnect behaviour · session persistence · timeouts ·
transport-specific errors · protocol negotiation · graceful shutdown.

These belong in a small transport/runtime layer. Do not create a generator so clever that
understanding a socket request requires debugging generated metaprogramming.

**The spec describes WHAT an operation is. The transport implements HOW MAX communicates.**

## 10. Source of truth and confidence

MAX is private and reverse-engineered, so the specification explicitly handles uncertainty. Do not
pretend undocumented information is official.

Where useful, allow metadata such as: source/reference · confidence · verified protocol version ·
notes · observed client/version. It should be possible to distinguish:

* confirmed by multiple implementations
* observed in one implementation
* inferred
* unknown

Do this simply; do not build a research database. The primary goal is maintainability when MAX
changes its protocol.

## 11. Spec scope for v1

**Do NOT attempt to document the entire MAX protocol immediately.** Start with only enough
protocol/API surface for:

* authentication
* current user
* chat list
* recent message history
* text message send
* logout/session removal

Potential command surface: `max login` · `max me` · `max chats` · `max messages <chat>` ·
`max send <chat> <message>`· `max logout`.

⚠ **Superseded 2026-09-19 (`NEED-48`).** Every command is now a resource and an action —
`max session start`, `max account show`, `max chats list`, `max messages list <chat>`,
`max messages send <chat> <text>`, `max session end`. The surface this section sketched is
unchanged in what it does; only the spelling moved. Left as written because this file is the brief,
not a description of the code — [`ARCHITECTURE.md`](ARCHITECTURE.md) is that.

Potential options: `--json` · `--limit` · `--profile` · `--verbose` · `--quiet`. Only add options
supported by real use cases.

Do not prematurely implement: realtime watch/listen · typing status · reactions · calls · voice ·
stickers · complex group administration · bulk messaging · broadcast · automated contact
discovery.

Attachments can come later unless they are needed structurally for parsing normal message
history. Basic attachment metadata should still be represented when reading messages if it appears
naturally in the protocol response.

## 12. Chat addressing

For v1 a numeric/internal chat ID is acceptable:

```sh
max messages 123456
max send 123456 "Hello"
```

But the core API is designed so resolution can be added later:

```sh
max messages "Ivan Petrov"
max send "School parents" "Hello"
```

**Do not make CLI parsing depend permanently on numeric IDs.**

## 13. Authentication and session persistence

Authentication is interactive only when necessary. Target experience — first time `max login`,
then SMS / QR / 2FA as supported; after that `max chats` reuses the saved session without asking
for SMS again.

Investigate how the chosen MAX library stores session state. Prefer OS keyring / Secret Service
for small sensitive credentials where practical, reusing the credential abstraction from Braze
CLI. However, do not force everything into the keyring if MAX session state is complex and the
chosen client legitimately needs a session database/file.

If a session file/SQLite database is required: store it under an appropriate user config/state
directory · enforce restrictive permissions · never print its contents · never commit it · redact
tokens from logs · document what sensitive information it contains.

Support named profiles/accounts in the architecture if this comes almost for free, but do not
overbuild multi-account support. Braze's production/staging environment abstraction probably does
NOT map to MAX — **do not invent a MAX "staging" environment.** Where generic profile support is
useful, prefer profiles such as `default`, `personal`.

## 14. Security

This is a local tool. Messages, session tokens and credentials must not pass through any
third-party service. Therefore: no Green-API or similar hosted intermediary · no remote proxy
service by default · no telemetry containing messages or credentials · no cloud session storage ·
no browser automation for routine usage.

If QR login technically requires a browser/device interaction, that is fine.
**Playwright/browser automation must NOT become the normal API transport.**

Secrets must be redacted from logs. Message bodies should NOT be written to diagnostic logs by
default. JSON command output is user-requested data output, not logging, so messages may
obviously appear there when the command asks to read them.

## 15. Logging

Reuse the logging approach from Braze CLI where appropriate. Human terminal UI and structured
application logs are different concerns.

Requirements: Pino or the existing logging abstraction · no ANSI colour sequences in structured
logs · stdout reserved for intended command output · stderr for diagnostics · secrets always
redacted · avoid logging full message bodies · useful `--verbose` diagnostics without leaking
auth material.

## 16. Output

Human mode is concise and attractive. `max chats` could display a compact table/list with chat
name · chat id · type · unread count · last message time. `max messages` could display timestamp ·
sender · text · attachment indicator.

JSON mode exposes stable objects. The chat model aims to normalize at least `id`, `title`, `type`,
`unreadCount`, `lastMessageAt`. The message model aims to normalize at least `id`, `chatId`,
`senderId`, `senderName`, `timestamp`, `text`, `outgoing`, `attachments`.

**Do not leak bizarre raw protocol objects through our public CLI contract** unless explicitly
requested with some future debug/raw option. The MAX adapter converts wire/library
representations into our stable domain models.

## 17. Retry semantics

Reuse generic retry/backoff/jitter infrastructure from Braze CLI, but adapt the semantics
carefully.

Reads may generally retry transient failures once by default where safe.

**Do NOT automatically retry message sending merely because Braze CLI retries some HTTP
requests.** A repeated `send` can create duplicate messages. Only retry sends if the MAX
protocol/library provides a verified client-generated message ID / idempotency mechanism that
guarantees deduplication. Otherwise surface the ambiguous outcome clearly.

This distinction is important.

## 18. Timeout and lifecycle

Every one-shot command terminates cleanly. No command stays alive because a WebSocket remains
open, a heartbeat timer remains running, an event listener remains attached, or a reconnect loop
remains active.

The architecture makes lifecycle explicit — open/connect, execute, close — using `try/finally` or
an equivalent lifecycle abstraction so connections are cleaned up reliably.

## 19. Read side effects

Investigate whether fetching chat/message history causes MAX to mark messages as read.

`max messages ...` should strongly preferably be observational and NOT mark messages read. If the
protocol has separate read acknowledgements, do not send them unless explicitly requested.
Document any unavoidable side effect.

## 20. Run/audit files

Braze CLI has CSV/run logging because bulk user mutations can involve thousands or millions of
records. **Do not mechanically create CSV files for every MAX command.**

Keep the reusable run/audit foundation in `cli-core` if it is genuinely generic. For listing
chats, reading messages and sending one message we probably do not need a CSV run artifact. If
batch operations, bulk messaging or migrations arrive later, the existing run/audit infrastructure
is there. **Do not implement bulk messaging now.**

## 21. Dry run

Keep generic dry-run support in `cli-core` if it is already cleanly implemented. For MAX, only
expose `--dry-run` on commands where it has a clear meaning — a future bulk send command may
benefit from it. **Do not add meaningless `--dry-run` flags to read-only commands.**

## 22. API escape hatch

Braze CLI has, or considered, a low-level/raw API command. For MAX, consider whether a
developer-facing command such as `max raw ...` or `max protocol invoke ...` would be valuable for
reverse engineering and quickly testing newly documented operations.

**Do NOT make this part of the first vertical slice unless it is extremely cheap.** If implemented
later it should accept an operation known to our spec · validate input · invoke through the normal
transport · support JSON · clearly identify itself as an advanced/debug interface. Avoid arbitrary
unsafe packet injection in the normal CLI.

## 23. Testing

Preserve the strong testing philosophy from Braze CLI:

1. unit tests for generic `cli-core`;
2. generated-schema tests;
3. transport/frame codec tests using fixtures;
4. adapter tests;
5. command-level tests;
6. JSON output contract tests;
7. generator snapshot/golden tests;
8. session/auth tests where practical without real SMS;
9. tests ensuring secrets are redacted;
10. tests ensuring commands actually close the transport.

Use captured/sanitized fixtures where useful. Do not require the real MAX service for most tests.
If integration tests require a real account, keep them explicitly opt-in.

## 24. Generated protocol fixtures

As MAX behaviour is reverse engineered or validated, preserve sanitized protocol fixtures where
legally and technically appropriate — for example `fixtures/protocol/...`. These help detect when
schema assumptions are wrong, optional fields appear, or response shapes change.

**Never commit phone numbers, session tokens, private message contents or personally identifying
data.** Use synthetic/redacted fixtures.

## 25. Dependency isolation

Do not allow a third-party MAX library to leak throughout the codebase. Create a small interface
owned by us, conceptually `MaxClient`, with operations such as authenticate · getMe · listChats ·
listMessages · sendMessage · close.

The concrete implementation can initially wrap `@bruch/max-client`, PyMax, or another chosen
library. Everything above that adapter speaks our own domain models. This makes replacing an
abandoned reverse-engineered dependency feasible.

## 26. `cli-core` extraction

Improve the Braze/MAX relationship instead of creating two copied codebases that immediately
drift. Inspect `../braze-cli` and propose a sensible structure — conceptually something like
`packages/cli-core`, `packages/max-core`, `packages/max-protocol`, `packages/max-cli`. **Do not
force a monorepo if the existing project structure suggests something simpler.** The goal matters
more than these exact names.

If extracting `cli-core` would create a large risky refactor of Braze CLI right now, propose a
staged migration:

1. copy and isolate reusable code;
2. get the MAX vertical slice working;
3. then move the shared code cleanly into a reusable package.

But avoid copy/paste divergence where easy abstractions are obvious.

## 27. TypeSpec/codegen investigation

Before committing to it, build a very small TypeSpec proof of concept for only a couple of MAX
operations — for example current user, list chats, send text.

Determine whether TypeSpec gives a clean representation of: MAX models · numeric operation/opcode
metadata · request/response pairs · optional/unknown fields · arrays/tuples if the MAX wire format
uses positional data · 64-bit identifiers · union types · protocol metadata. Then demonstrate
generated output.

**If TypeSpec requires an enormous custom framework for this, stop and reconsider.** The fallback
is a small declarative YAML/JSON protocol manifest whose payload schemas use JSON Schema 2020-12.
**Do NOT fall back to OpenAPI just to avoid writing a small custom emitter.** Choose the simplest
source-of-truth representation that genuinely matches MAX.

## 28. Generator implementation principles

The code generator itself should be boring:

```text
spec → parsed AST/model → normalized internal representation → small deterministic emitters
```

Possible emitters: TypeScript types · Valibot schemas · operation registry · typed client methods ·
Markdown protocol docs.

Do not mix filesystem writes throughout parsing logic. Make generated output reproducible. Use
formatting automatically after generation. A malformed/ambiguous spec fails generation with a
clear error.

## 29. Unknown fields and protocol evolution

Because this is an unofficial API, be tolerant when reading data. Do not make every unknown
response field fatal. Prefer validating the fields we rely upon while permitting extra fields
where appropriate. **For requests we send, be stricter.**

The public domain model remains stable even if raw MAX responses contain additional fields. Where
protocol version/fingerprint information is needed, centralize it rather than scattering magic
constants through generated code.

## 30. Documentation

Create concise developer documentation explaining: architecture · why TypeSpec/a custom spec is
used instead of OpenAPI · how to update the MAX spec · how to regenerate · generated vs
handwritten files · how to add a new MAX operation · session storage/security · how to run
integration tests · relevant upstream/reference projects.

Also include a generated operation coverage document if useful.

## 31. First deliverable

**Do NOT implement the whole project immediately.** First inspect:

1. `../braze-cli`;
2. the strongest MAX client candidates;
3. `renosaza/max-mcp`;
4. protocol documentation/reference implementations.

Then produce a concrete architecture proposal **based on the ACTUAL code**, covering: what parts
of `braze-cli` we reuse · what becomes `cli-core` · what remains Braze-specific · whether we copy
first or refactor shared code first · which MAX library/transport we choose · why · whether Node
or Bun is appropriate · how session storage works · the TypeSpec vs custom JSON Schema/YAML
conclusion · exactly what gets generated · exactly what remains handwritten · the proposed
package/directory structure · the proposed commands · known protocol/auth risks.

**Do not give generic architecture prose.** Reference actual files/classes/functions from
`../braze-cli` and actual code from the MAX libraries inspected.

## 32. Second deliverable

After the architecture is settled, implement the smallest end-to-end vertical slice:

```sh
max login
max me
max chats --json
max messages <chat-id> --limit 20 --json
max send <chat-id> "test" --json
max logout
```

At minimum this demonstrates: shared CLI infrastructure · the MAX adapter · persisted
authentication/session · generated spec-backed types and operation metadata · runtime validation ·
human output · JSON output · proper error handling · clean connection shutdown · tests.

**Do not implement realtime functionality yet.**

## 33. Important engineering principles

Keep it small. Do not introduce server infrastructure · Docker · Redis · databases other than a
session DB if genuinely required by the MAX client · browser automation · an agent framework · a
queue · a background worker · a telemetry service — unless there is an unavoidable technical
reason.

Prefer boring, understandable code. Avoid speculative abstraction. Do not duplicate abstractions
already present in `../braze-cli`. Do not rewrite working Braze infrastructure merely because
another package is fashionable. Do not expose third-party MAX library types as our public API. Do
not make transport-specific details leak into CLI commands. Do not own more reverse-engineered MAX
protocol implementation than necessary — but do own our spec, our stable domain API and our CLI
UX.

**When there is a trade-off between maximal protocol coverage and a clean maintainable
implementation of the five commands actually needed, choose the latter.**

## 34. Client identification

Added by the owner on 2026-09-18, after the brief (`NEED-2`).

**Do not invent our own client identity. Imitate the official MAX client everywhere it is
visible to the server** — the user agent string above all, and with it whatever else the official
client sends to describe itself: client version, platform, device and locale fields, protocol
version constants.

No custom user agent, no "max-cli/0.1.0", nothing that names this tool. The values come from what
the official client actually sends, recorded with their source the same way as every other
protocol constant (§10), and they live in one place rather than being scattered through generated
code (§29).

## 35. Scope after v1 — the phases

Added by the owner on 2026-09-19 (`NEED-13`), extending §11 rather than replacing it. **v1 is
still the six commands of §11 and nothing else.** What changes is the horizon they are designed
against.

Wanted, in the owner's order of interest:

* **contacts — first, and definitely wanted.** They also make chat addressing by name (§12)
  possible, which is what removes numeric ids from everyday use.
* then, later and in no fixed order: **uploads · reactions · group administration**.
* **stories** and **calls** last: large surfaces with no current use.

Two consequences for v1, both cheap now and expensive to retrofit:

* every operation in the spec carries its source and confidence from the first entry (§10),
  because the later phases add operations nobody has verified;
* the domain model gets a person type from the start, because chats and messages both reference
  people.

Also ruled with it:

* **A local SQLite cache** for conversations and contacts, in its own phase after the vertical
  slice works (`NEED-14`). A messenger client that re-fetches everything on each invocation is the
  wrong shape; the cache is also what makes reads instant and connections rare. It never holds the
  session token.
* **Telemetry**, in a later phase, sending what other clients send (`NEED-16`). This follows §34:
  a client that is silent where every real client is chatty is itself distinguishable. Nothing is
  sent in v1.

## 36. Runtimes

Added by the owner on 2026-09-19 (`NEED-11`), settling the open question §5 left.

**Node 22+ and Bun are both supported, and "it works under Bun" is tested, not assumed.**
`braze-cli` already does this — `pnpm smoke:bun` runs its core under the second runtime in CI —
and the same check applies here.

The consequence is a rule rather than a preference: **where the two runtimes differ, the difference
is held behind one seam and chosen once.** Measured on 2026-09-19 — Node v24.19.0, Bun 1.3.14 —
`node:sqlite` does not exist in Bun and `bun:sqlite` does not exist in Node, so the cache of §35
takes its driver as an argument like everything else the environment provides. The WebSocket client
is the `ws` package, which sends custom headers identically on both.
