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
**`max-cli`.** «1 max-cli». The repository half is measured rather than decided: `origin` is
already `git@github.com:CLI-Heaven/max-cli.git`, and the organisation holds exactly two
repositories — [`CLI-Heaven/max-cli`](https://github.com/CLI-Heaven/max-cli) and
[`CLI-Heaven/cli-core`](https://github.com/CLI-Heaven/cli-core) (`gh repo list CLI-Heaven`,
2026-09-18). So the project, the repository and the package are `max-cli`.

**NEED-4 · Is the typed command `max` or `max-cli`?**
**`max`.** «1 A». The package is `max-cli` and the command is `max`, the same split `braze-cli`
uses — it publishes as `@leemour/brazecli` and types `braze`. A command gets typed by hand and by
agents dozens of times a day; the package name is read once, in an install line. The npm scope is
the one piece still open and is decided with the first publish (`OPS-1`); the organisation
suggests `@cli-heaven/max-cli`.

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
if needed by consumers». HTTP lives under `@cli-heaven/cli-core/http`; `braze-cli` imports it and
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
https://github.com/CLI-Heaven/cli-core есть уже». Verified: the repository exists, is public and
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
