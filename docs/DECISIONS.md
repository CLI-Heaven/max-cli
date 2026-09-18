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
