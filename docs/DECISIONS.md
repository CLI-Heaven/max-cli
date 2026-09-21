# Decisions

Rulings by the owner, lifted out of the session journals. A journal is a trail of one day and is
short-lived; a decision holds until it is overturned, so it lives here.

**The `NEED-nn` number is the same one that appeared in the journal and in the reply footer.**
Plans, commits and other docs cite it. Numbers are never reused.

**How to use this file.** Found behaviour in the code or a document that looks wrong? Look here
before fixing it. A document that contradicts a line here is the thing that is wrong, not the
decision.

**An overturned decision is struck through, not deleted**, with a note saying what replaced it.

**What does not belong here.** The brief itself is not a set of rulings — it lives in
[`REQUIREMENTS.md`](REQUIREMENTS.md) and is cited by section. This file only carries answers given
*after* it, when a question came up that the brief did not settle.

---

## 2026-09-18

**NEED-1 · What are the command, the npm package and the repository called?**
**Command `max`, repository `leemour/max-cli`, package ~~`max-cli`~~ `@leemour/max-cli`.**

⚠ **Both moved on 2026-09-21 (`NEED-111`)**: they were created under a shared organisation and
now live under the owner's own account. The reasoning below is the reasoning of the day it was
written; only the names have moved, and the typed command was never affected — it is still `max`.

⚠ **Correction 2026-09-19: the unscoped `max-cli` is not ours to take.** `npm view max-cli`
reports version 1.0.3, published 2018-07-04 by `ruanjiayou`, an unrelated scaffolding tool. A
publish attempt failed on it. This is the second time in this family of projects that an unscoped
name was already occupied — `braze-cli` became `@leemour/brazecli` for the same reason — so the
scope is now the default rather than the fallback — the unscoped name is gone either way.
The typed command is unaffected and stays `max` (`NEED-4`).

The original ruling, which the scope narrows rather than overturns:

**`max-cli`.** «1 max-cli». The repository half was measured rather than decided: `origin` already
existed, beside exactly one sibling — [`max-cli`](https://github.com/leemour/max-cli) and
[`cli-core`](https://github.com/leemour/cli-core), measured 2026-09-18 under the organisation they
were created in. So the project, the repository and the package are `max-cli`.

**NEED-4 · Is the typed command `max` or `max-cli`?**
**`max`.** «1 A». The package is `max-cli` and the command is `max`, the same split `braze-cli`
uses — it publishes as `@leemour/brazecli` and types `braze`. A command gets typed by hand and by
agents dozens of times a day; the package name is read once, in an install line. The npm scope is
the one piece still open and is decided with the first publish (`OPS-1`); a scope is suggested
rather than a bare name.

**NEED-2 · The account-safety question raised while writing the brief.**
**Settled, closed, and not to be raised again** — not in replies, not in documents. «принимаем
риск, больше об этом не надо, в тч в доках». The backlog item and the open question are deleted.
This line exists only so that the next agent, finding no mention of it anywhere, does not
rediscover it and write it back in.

**It came with a requirement of its own**: we never present ourselves as a client of our own.
«User agent не пытаемся делать кастомным, имитируем везде оф клиента» — the user agent and every
other field identifying the client imitate the official MAX client. Recorded as
[`REQUIREMENTS.md`](REQUIREMENTS.md) §34, which is where it is cited from; this is a pointer, not
a second copy.

## 2026-09-19 (later)

**NEED-97 · When may a subsystem fail quietly, and when must it fail loudly?**
**It depends on who asked for it, and the two rules are deliberately opposite.**

- **Something the person asked for fails loudly.** `--record` was typed; a run log that cannot
  start has failed to do the thing it was told to do, so the command fails. Thread B's rule.
- **Something nobody asked for fails quietly — but never invisibly.** The cache is an optimisation
  the person never requested, so it must not break a command it was only meant to help. It says
  why on the diagnostic stream and the command continues.

The second half of that sentence was learned the hard way. The cache swallowed its reason as well
as its failure, and was **entirely off on every machine for a day** while its tests passed — the
directory it needed was never created, and silence made that indistinguishable from working. Two
sessions disagreed about what the tool did until one of them ran it with `--verbose`.

Recorded so the two rules stay a decision rather than two habits that happen to differ.

**NEED-51 · Does the run log go into the SQLite database the cache phase brings?**
**No — files for the log, SQLite for the cache.** «1 A». Two reasons decide it. They have opposite
lifecycles: the cache is disposable and rebuilds from MAX, the run log is the one thing that
cannot be rebuilt, so one store means clearing a corrupt cache throws away the audit trail. And
two `max` invocations run at once here, because scripts and agents drive it — two appends to two
files never conflict, while two writers on one database take a lock and a busy writer starts
failing the command it was only supposed to describe.

Supporting: an append-only file keeps everything written up to the moment a process died, which is
the run worth reading; and logging through the injected driver seam (`NEED-11`) would tie the log
writer to the runtime and block it on a cache phase that has not started.

**NEED-59 · The `ExperimentalWarning` `node:sqlite` prints on Node 22.**
**Left alone.** «2 C». Measured 2026-09-19: Node 22.23.2 has `node:sqlite` unflagged and working,
and prints `ExperimentalWarning: SQLite is an experimental feature` to stderr on import; Node 24 is
silent. It does not break the stdout contract, and suppressing warnings process-wide to hide one
line costs more than it saves.

**NEED-48 · Is every command a resource and an action, including `login` and `logout`?**
**Yes, with no exceptions.** «1 B». `max session start` and `max session end`, alongside
`max account show`, `max chats list`, `max contacts list`, `max messages list` and
`max messages send`. The shape is `braze-cli`'s, read from its source rather than its README —
`../braze-cli/packages/cli/src/commands/runs.ts:49,69,81`.

I argued for keeping `login` and `logout` as the two words every tool on earth uses, and for an
agent that has never read our help. Overruled in favour of one rule with no exceptions to
remember, and **no aliases** — two spellings of one command is what `--profile` was deleted for.

**NEED-49 · How long does a recorded run live?**
**30 days, pruned when a run is recorded.** «2 A», with the number as a configuration setting.
Pruning happens only while something is being recorded: a tool that is not recording has no
business walking that directory.

**NEED-52 · Does `max runs` survive recording being off by default?**
**Yes, and an empty list says why.** «3 A». `max runs list` with nothing to show prints that
recording is off and names `--record`, rather than an empty result that reads as broken.

**NEED-45 · Is `--profile` kept alongside the profile as the first word?**
**No, deleted.** «no, but accept env var». `max personal chats list`, or `MAX_PROFILE`, and
nothing else.

**NEED-34 · Do the generated per-operation functions become public, or does one client stay the only door?**
**One door, and it is regrouped.** «2 C». Not the two options first put — the third: the seven
existing methods take the shape `REQUIREMENTS.md` §8 sketched — `client.chats.list(...)`,
`client.messages.send(...)`, `client.account.me()` — while remaining the same methods, with the
name filling, the domain mapping and the resend rule still inside them. The generated functions
stay an inner layer.

The option rejected is the one that would have published them alongside: that gives raw MAX
answers a second public entrance, around the rules that make sending safe.

**NEED-35 · Are MAX's answers checked against the spec on the live path?**
**Yes, and nothing ever fails because of it.** «3 B», with the instruction that response typing
stay loose because MAX may change. Both hold at once: unknown fields pass through and are kept,
every field we do not depend on is optional, and the check reports rather than decides. A
mismatch is one line on stderr and no change to the exit code — the failure being prevented is the
silent one, where a renamed field turns a column into blanks and nobody learns why.

⚠ Valibot's own error text quotes the value it received, so the note is assembled from the field
path and the expected type by hand. Printing `issue.message` would put a message body on the
screen (`REQUIREMENTS.md` §14, §24).

**NEED-36 · Does building start on the accepted plan?**
**Yes.** «1 A». The plan is `docs_ai/plans/2026-09-19-spec-generator.md` on the machine that wrote
it; its decisions land here as they are made.

**NEED-27 · Do we measure whether MAX deduplicates by `cid`?**
**Yes, and it does.** «2 A», measured in the Saved-messages dialog with the owner's agreement. The
same `cid` sent twice returned the same message id and left one copy — and it held across two
separate connections and logins, which is the case a retry actually faces. This is what §17 asks
for before a send may be retried, so a lost send is now retried once with the same `cid` and never
a fresh one. What is still unmeasured is how long the server remembers one:
[`ARCHITECTURE.md`](ARCHITECTURE.md) §6.

**NEED-28 · Which chat is safe to send a test message to?**
**The Saved-messages dialog, which is `DIALOG` id `0`.** The owner sent a message to it so it could
be found. Worth recording because the obvious heuristic is wrong: "one participant" also describes
**channels you own**, and sending to one of those reaches its subscribers.

**NEED-30 · What comes after the vertical slice?**
**Contacts.** «2 да». Names for one-to-one chats and addressing a chat by name — without them
`max chats list` shows a column of blanks for exactly the chats a person recognises.

**NEED-31 · Documents, the spec and generator, or an interactive login?**
**Documents first.** «1 A». `ARCHITECTURE.md` and bringing the rest in line with the code, before
the next feature. The spec module and generator (`NEED-7`) remain the next piece of building.

**NEED-32 · Who removes the three test messages left in Saved messages?**
**The owner, by hand.** «2 A». `MSG_DELETE` (66) stays untouched: implementing deletion to tidy up
after myself is a poor reason to give a tool the ability to destroy messages.

**NEED-17 · Our own WebSocket adapter, or `@bruch/max-client`?**
**Our own.** «1 А». Option B of [`REQUIREMENTS.md`](REQUIREMENTS.md) §5. This was the last
unruled decision in the architecture proposal and the one everything else rested on.

The reasoning, now that Bun is supported (`NEED-11`) and "the library needs Bun" is no longer
disqualifying on its own: even under Bun we would replace its session layer, write our own domain
mapping, and own the lifecycle anyway — and the MAX WebSocket path is plain JSON with nine opcodes
for v1. The dependency would cost more to work around than to replace. Its source stays the
reference implementation, and the `MaxClient` interface (§25) keeps it available as a backend if
TCP, uploads or QR ever justify it.

**NEED-8 · Do we guard against burning the session token?**
**Count and diagnose; never refuse.** «3 А». The ceiling proposed first rested on a single
undefined phrase — "~30–50 logins in a short interval" — in one document, with no window, no error
code and no corroboration. Refusing a command on an unmeasured limit would break exactly the
scripted use this CLI exists for.

Instead: persist the token the login response returns (clients do rotate it — `tsmax/src/app.ts:99`),
turn the documented symptom — a connection that closes immediately after INIT — into a plain error
naming the fix, and count logins per profile so that if it ever happens we have a real number. The
cache of `NEED-14` reduces the question further: a read served locally opens no connection at all.

**NEED-10 · Does the `cli-core` extraction wait for the proposal to be read in full?**
**No — start now.** «2 А». The first step moves files that change under no possible outcome of the
remaining discussion: the output streams, the renderer, exit codes, the keyring seam and the
clocks.

**NEED-11 · Node or Bun?**
**Both, and Bun is tested.** «Node 22+ and Bun should be supported, we should test it just works
with bun». This closes the runtime question §5 left open and makes `braze-cli`'s `smoke:bun` check
a requirement here rather than an inheritance.

Measured the same day, Node v24.19.0 and Bun 1.3.14: the `ws` package sends a custom `Origin`
header on both runtimes, `node:sqlite` does not exist in Bun, and `bun:sqlite` does not exist in
Node. So the WebSocket client is `ws`, and the SQLite driver of `NEED-14` is injected rather than
imported. ⚠ `node:sqlite` on Node **22** was not measured and may still need
`--experimental-sqlite`; that has to be checked before the cache phase.

**NEED-12 · One published package here, or a workspace like `braze-cli`?**
**One package.** «cli-core is ok, but don't split the code into real packages, use just internal
split but don't publish 2 packages (no max-core, max-cli)». `max-cli` publishes alone and splits
internally by directory; `cli-core` remains a real, separate, published package because it has two
consumers in two repositories.

The seam the two packages used to enforce still holds and is now a lint rule: **`src/commands/`
never imports from `src/protocol/`.** Commands speak the domain model; only the client speaks the
protocol.

**NEED-13 · How much of the messenger do we eventually cover?**
**Contacts early; uploads, reactions and group administration later; stories and calls last.**
«contacts, stories, calls, uploads, reactions, group administration — I think we should do it,
contacts for sure, the rest mb just a bit later in late phases». v1 is unchanged — still the six
commands of [`REQUIREMENTS.md`](REQUIREMENTS.md) §11 — and the phases are written out in §35.

**NEED-14 · Do we keep a local cache, and in what?**
**Yes, SQLite, in its own phase.** «let's use sqlite too for keeping the conversations in there as
cache etc, we can add it in a separate phase but it's needed for a messenger cli». After the
vertical slice, never holding the session token, and behind a driver seam because the two runtimes
have different built-in SQLite modules (`NEED-11`).

**NEED-15 · Does `cli-core` carry HTTP?**
**Not in its root export.** «cli-core's root export carries nothing HTTP - ok, agreed only import
if needed by consumers». HTTP lives under `@leemour/cli-core/http`; `braze-cli` imports it and
`max-cli` never does, which is what keeps a WebSocket CLI from depending on an HTTP stack it does
not call.

**NEED-16 · Do we send telemetry?**
**Not in v1; in a later phase, what other clients send.** «let's add telemetry as other clients in
later phases». Consistent with §34: imitating the official client is the rule, and silence where
every real client is chatty is itself a signal.

**NEED-7 · Is the protocol spec a TypeScript module or TypeSpec?**
**A TypeScript module.** «1 А». The operation definitions are ordinary TypeScript —
`defineOperation({ opcode, request, response, source })` with Valibot schemas as the literal
source — and the generator emits the opcode registry, the typed client, the protocol reference and
the coverage report from them.

This is chosen **over** TypeSpec, which was built and does work: `@typespec/compiler@1.16.0`, three
operations, custom `@opcode` / `@responseOf` / `@authRequired` decorators and a custom emitter,
about 60 lines of plumbing. The cost that decided it is not the plumbing but the emitter — turning
`.tsp` into Valibot means owning a construct-by-construct mapping (unions, enums, nesting, bigint,
tolerant reads versus strict writes) for a schema language we do not control, to produce validators
we would otherwise write directly. The proof of concept is kept as the migration path: if the
operation count passes ~30 or a second language needs the spec, only the emitter has to be
written and the specification itself does not change.

**NEED-3 · Where does `cli-core` live, and when is it extracted?**
**Its own repository, and now.** «выноси сейчас в отдельную папку и repo
https://github.com/leemour/cli-core есть уже». Verified: the repository exists, is public and
is empty, created 2026-09-18 20:03 UTC, described as "Core CLI package to develop cli to any HTTP
API".

Three consequences, all carried in [`BACKLOG.md`](BACKLOG.md): §26's staged "copy now, extract
later" route is closed (`CORE-1`); two repositories cannot share a private workspace package, so
`cli-core` has to be published or otherwise pinned (`CORE-4`); and `braze-cli` moves onto the
extracted package rather than keeping its own copy, which is the whole point of extracting instead
of copying (`CORE-5`).

⚠ **The repository's description says "to any HTTP API", and MAX is not an HTTP API.** The CLI
infrastructure — output modes, config, credentials, errors, runs — is transport-agnostic and is
what MAX needs; an HTTP client is a different concern that happens to be what Braze needs. If both
live behind one entry point, MAX ends up depending on an HTTP stack it never calls. `RES-1` draws
the inventory and this is the line it has to cut along.

## 2026-09-20

**NEED-53 · Is a `--verbose` diagnostic text or JSON, and which flag wins when `--quiet` is given
with `--verbose`?**
**Text for a person, one JSON object per line for everything else — and `--verbose` wins.**
«3 A», confirmed by the owner 2026-09-20.

It was decided by the thread first, not by him: the handoff splitting this work (§10) said a
question both threads would hit is settled by whichever reaches it first, written down here, and
followed by the other. Thread B reached it and he then confirmed it, so it is a ruling like any
other.

The format follows what `resolveOutput` already decides for the data stream (`src/output.ts:22`):
a terminal gets `→ chats.history   op 49  seq 3  chat 0`, a pipe gets a line `jq` can read. One
rule for both streams rather than two, and no new question for the next command to answer
differently.

`--verbose` beating `--quiet` is the less obvious half. Neither flag touches stdout, so the
machine-mode contract is not involved either way; what decides it is that `--quiet` usually sits
in a script written once, and `--verbose` is what a person adds to that script's command line when
something has gone wrong. The flag someone just typed has to do something. `--quiet` keeps its
meaning for everything else diagnostic.

**NEED-88 · Does `max runs path` print a bare path, breaking "one JSON value on stdout" for that
one command?**
**No — `{"path": "…"}`, and the rule keeps no exceptions.** «1 B». A script reads
`max runs path <id> --json | jq -r .path`; a terminal gets the bare path on a labelled line.

I argued for the bare path, copying `braze-cli`, because the whole use of the command is
`cat "$(max runs path <id>)/events.jsonl"` and quotes break exactly that. Overruled, and the
reason is worth keeping: a contract with one exception in it is a contract everybody has to
remember, and the one thing this tool promises agents is that stdout can be parsed without
knowing which command produced it.

**NEED-89 · In what order do the three open pull requests land?**
**Thread B's `#12` first, then the others rebase onto it.** «2 A». The cache thread argued for
`#10` first, because it repairs a cache that has never once worked on `main`; a fair argument, and
the owner chose otherwise. The overlap is four lines in `src/program.ts`, which the next branch
resolves on its rebase.

**NEED-107 · What number does the first shareable release carry?**
**`0.1.0`.** «1 A». Zero-major says plainly that the commands may still change, which is true —
the protocol underneath is reverse-engineered and half of `CLI-4` is not merged yet — and nothing
about sharing it waits for a `1.0.0`. Set in `package.json`, copied into `src/version.ts` by
`pnpm version:sync`, and kept in step by `pnpm version:check` in CI.

**NEED-108 · Is "docs should be in Russian" the whole of `docs/`, or only the pages a user opens?**
**Every document written from now on is Russian; the English ones that already exist are left
alone.** «lets have all docs in russian since the public ones are in russian. don't change existing
non-public».

So: the user-facing set of `DOC-2` is Russian, and so is any new engineering document. What is
**not** touched is `ARCHITECTURE.md`, `CONVENTIONS.md`, `DECISIONS.md`, `REQUIREMENTS.md`,
`TESTING.md` and `BACKLOG.md` — they stay English, are not translated, and a new section added to
one of them follows the language of the document it lands in rather than starting a bilingual file.

I had proposed splitting by audience — Russian for the user, English for the builder — and the
ruling is narrower and simpler: language follows the calendar, not the reader. It also avoids the
cost that killed the alternative, which was translating documents that code cites by section
number.

**NEED-105 · A group member is not a contact. A flag, or somewhere else to put them?**
**Somewhere else: a table of people and a table of memberships.** «I'd add a flag for them to not
list them in contacts since they arent contacts or mb even put them in a separate table and join
these records to groups/chats, this way we won't loose this data and also we can find stuff like
which groups you share with a person etc.»

The `contacts` table becomes **`people`** — everyone MAX has named for us, whatever the reason —
and **`chat_members (chat_id, person_id)`** holds who is in what. `contacts list` then asks for
people a *dialog* exists with, so group members are outside the answer because they are outside
the query, not because a flag hides them. `dialog_with` on `chats` goes: the join replaces it.

The rename is the point. A table called `contacts` holding people who are not contacts is the
kind of lie that costs an afternoon six weeks later, and during a rebuild migration it is free.

What it buys beyond tidiness: **"which groups do I share with this person"** is one indexed
lookup, because every chat in the store is one the owner is in. The commands that would read it —
`max contacts show`, `max chats members` — are deliberately not invented yet; the data is kept so
they can exist the day somebody wants them.

⚠ **One exception to "the store never deletes".** `chat_members` is replaced per chat, because
MAX restates a chat's whole membership whenever it sends that chat — so a member who is absent has
left. A *person* absent from a delta is merely unchanged, which after the first login is the
normal case. Replace the rows of the chats in the delta, never all of them.

**NEED-106 · The login returns a rotated `token` we ignore. Start persisting it?**
**Yes, and as its own piece of work.** «2 A». The login response carries a `token` field and we
drop it, keeping forever the one that was pasted in. `NEED-8` said on 2026-09-18 that clients
rotate it and that we should persist it, and nothing ever did. It changes what is in the owner's
keyring, so it gets its own commit and its own live check rather than riding along with the
contacts work: `MAX-11`.

**NEED-102 · Does `contacts` mean the people you have dialogs with, or everyone in your chats?**
**Everyone in your chats.** «but we also need a way to get contacts of all chat/group
participants». Measured the same day: the login's chats hold **23 distinct people** and its
`contacts` names **6**, because `#partnerOf` (`src/client.ts:406`) gives up on any chat with more
than one other person. Groups and dialogs list their whole membership, so this costs no request
per chat — **channels are skipped**, their `participantsCount` being a subscriber count (178 011
on one here) rather than a membership. `ARCHITECTURE.md` §7; plan §3.4a.

**NEED-103 · Do `presenceSync` and `draftsSync` get a delta marker too?**
**Try all four.** «2 B». Measured 2026-09-20: a week-old marker in all four fields returned the
same as a marker in two, and the profile still arrived — so they are harmless. Nothing reads
presence or drafts, so they stay at `0` until something does; the measurement exists so the next
agent does not have to make the change to find out.

**NEED-100 · Three shapes of the contacts work, settled together.**

- **The envelope is built by a helper each command calls**, not inside `renderer.result`. «where
  the envelope is built: a helper». `account show` and `session start|end` are not lists and keep
  answering a bare object, which a renderer-level envelope could not distinguish.
- **The sync merges before the command renders.** «refresh runs before». The names it brings are
  what the listing prints, so rendering first would show the previous run's names and be one
  command stale for no reason.
- **`--before` on `messages list` takes a message id, and a timestamp when the id cannot be
  resolved.** «and timestamp if no id under the hood (eg message deleted, use timestamp)». A
  deleted message is exactly that case: it is gone from the history MAX returns, so its id means
  nothing to anybody, and refusing would strand the caller at a boundary they cannot get past. A
  bare integer is always an id; a time must be ISO 8601, because a message id and epoch
  milliseconds are both bare integers and telling them apart by length is a trap.

**NEED-99 · May opcode 36 be sent once, to find out what it is?**
**Yes.** «2 A». Done 2026-09-20 and it did not settle `PROTO-1`: the opcode **exists and validates
its payload** — `{}` and `{marker: 0}` come back `proto.payload`, and `{marker: 0, count: 100}`
closed the connection, which is where the guessing stopped. Three guesses on a real account is a
measurement; a dozen is fishing. What is left is a traffic capture (`RES-7`).

The same run answered a bigger question nobody had asked — see `ARCHITECTURE.md` §7 and `MAX-10`:
`contactsSync` and `chatsSync` are delta markers, and sending `0` in them is why every command
re-fetches everything.

**NEED-86 · For a paged list, does `--json` print an array or an object carrying the page?**
**An object, and only in the machine modes.** «1 B». `{items, page, limit, hasMore}` on stdout for
`--json` and for a pipe; a person still gets the table. An array cannot say whether another page
exists, so an agent either guesses or asks again and compares counts — and this contract is cheap
to change exactly once, before anything is published. `hasMore` is a boolean rather than a total:
counting rows MAX has not sent is a second question with a second cost.

**NEED-87 · The 2026-09-19 token paste still sitting in two old session logs.**
**Closed. Not to be raised again** — not in replies, not in documents. «2 don't care about token,
forget». One log was deleted on 2026-09-20 before the ruling; the rest were left alone and the
cleanup list no longer carries them. This line exists only so that the next agent, finding a token
in an old log, does not rediscover the subject and write it back in. Same treatment as `NEED-2`.

**NEED-90 · Who takes the contacts work?**
**A fresh agent — thread D — and the plan is written out in full first.** «3 prepare the full
plan». So `docs_ai/plans/2026-09-20-contacts-and-paging.md` carries the schema, the store
interface, the command surface, the settings, the budget semantics and the checks rather than
leaving them to be decided while building, and a handoff sits beside it.

**NEED-84 · Must the profile be the very first word, or are leading global flags skipped?**
**The very first word, strictly.** «2 A». `max personal chats list` works and
`max --json personal chats list` does not — `personal` is read as a command there and the command
fails. The rule is one sentence to explain and one line to implement; skipping leading flags is
argument parsing before argument parsing, and it breaks as soon as a global flag takes a value.

**NEED-81 · Does `contacts list` show everyone by default, or 20 like the other commands?**
**Twenty — but the question was answered wider than it was asked.** The contacts a person sees
first are **the twenty they last exchanged messages with**, not the first twenty by name; contacts
live in SQLite with a **sync** of their own; a profile that has been synced is **refreshed at the
start of a command, inside a request budget** («a limit of say 5 requests»); and **paging
parameters are standard across every command** — per-page and a way to ask for the next page —
with defaults in the configuration file.

«store contacts in sqlite … I'd for sure add smth like contacts sync to get all contacts and if
they were synced I'd update them on start (with a limit of say 5 requests etc). So yes we can show
maybe 20 last contacts user messaged by default, but I'd add more settings like per-page and allow
pagination etc (these params shoudl be standard for all commands)».

⚠ **Correction 2026-09-20, after measuring: two parts of this ruling were wrong, and the owner's
instinct was right.**

**"With a limit of say 5 requests" describes work that turns out not to exist.** `contactsSync`
and `chatsSync` in the LOGIN request are delta markers — MAX returns only what changed since the
time given — and we send `0` in them (`ARCHITECTURE.md` §7). The sync is therefore a field we stop
zeroing, carried by a login every command already performs. There is no budget to cap, no interval
to tune and no refresh to schedule, and the two configuration settings drafted for them are gone.

**"All contacts needs an operation we do not have" was half right.** Opcode 36 was sent once with
permission (`NEED-99`) and still cannot be used. But most of the gap did not need it: the login's
chats already carry **23 distinct people** where its `contacts` names **6**, and the tool was
discarding the difference (`NEED-102`). What opcode 36 would add is only people who are in no chat
at all.

The plan is `docs_ai/plans/2026-09-20-contacts-and-paging.md`, rewritten around both.

**NEED-109 · How much of `DOC-2` is written now, and how much waits?**
**Two pages now — `installation.md` and `usage.md` — the rest afterwards.** «1 C». They are the
two a person needs in order to install the tool and read their own chats, which is the readiness
test the release plan sets; the remaining five are written without holding the release behind them.

Recorded because it also sets the shape of what "done" means for `OPS-4`: a release ships when
somebody can follow the instructions on a clean machine, not when the documentation set is
complete.

## 2026-09-21

**NEED-111 · Where do the repository and the package live?**
**`leemour/max-cli` and `@leemour/max-cli`; `cli-core` moves the same way.** Owner's instruction:
«I actually changed the repos to leemour/cli-core and leemour/max-cli … let's publish as
@leemour/max-cli». Supersedes the naming half of `NEED-1`.

Done here: both `git remote`s repointed, `package.json` renamed, and every mention rewritten in the
documents — the repository links, and the npm name of **this** package.

**The dependency moved too**, on the owner's instruction of 2026-09-21 that no trace of the old
scope remain: every import, the `package.json` entry and the workspace pin now name
`@leemour/cli-core`.

⚠ **That sets the publish order and cannot be reordered.** `@leemour/cli-core@0.1.0` has to reach
npm **before** this package is installable at all — a dependency pointing at a name nobody
published fails every install, including `pnpm install --frozen-lockfile` in CI. So: publish
`cli-core`, then `max-cli`.

⚠ What was published under the previous scope stays there; it cannot be unpublished usefully after
72 hours and should be deprecated so that anyone who finds it is sent here. The exact commands are
in the release handoff rather than in this repository.
