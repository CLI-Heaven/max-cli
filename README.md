# MAX CLI

A local command line interface for a normal personal [MAX Messenger](https://max.ru) account:
connect, run one operation, print the result, disconnect. Built for AI agents and scripts first
and for people second — every data command answers with stable JSON on request.

**Status 2026-09-20: it works, and it is not released.** Published one day as
`@cli-heaven/max-cli`; typed as `max`. Seven commands run against the real service —
`session start|end`, `account show`, `chats list`, `contacts list`, `messages list|send` — every
request they send is declared once in `src/spec/`, and `max runs` reads back what the tool did.
Nothing is on npm yet. What it is meant to be, in the owner's own words, is
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md); how it is put together is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); what is left is
[`docs/BACKLOG.md`](docs/BACKLOG.md).

## What it keeps, and what it never keeps

Nothing is written unless you ask. `--verbose` shows one line per request on stderr as it happens;
`--record` keeps the same lines under `max runs list`, for 30 days. Both carry the operation, the
opcode, the ids the request named, the timings and the sizes — and **never a chat title, a name, a
message body, a phone number or a token** ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §13).

```text
→ chats.history   op 49  seq 3  chat 0
← chats.history   op 49  seq 3  118ms  4.2 kB  3 messages
```

It is a sibling of `braze-cli`, deliberately: the same TypeScript, pnpm, Commander, Valibot and
Pino stack, the same separation between a portable core and the terminal, and the same rule that
in machine mode stdout carries data and nothing else. The half both commands share is being
extracted into [`CLI-Heaven/cli-core`](https://github.com/CLI-Heaven/cli-core) rather than copied.

Not the official MAX Bot API — this speaks the protocol a normal user account speaks, which is
unofficial and reverse engineered ([`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) §4).

Documentation index: [`docs/README.md`](docs/README.md).

## Licence

MIT.
