# MAX CLI

A local command line interface for a normal personal [MAX Messenger](https://max.ru) account:
connect, run one operation, print the result, disconnect. Built for AI agents and scripts first
and for people second — every data command answers with stable JSON on request.

**Status: not built.** Installed one day as `@cli-heaven/max-cli`; typed as `max`. This repository holds the brief and the working rules; there is no code
yet, and nothing here is installable. What it will be, in the owner's own words, is
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md); what is left to do is
[`docs/BACKLOG.md`](docs/BACKLOG.md).

It is a sibling of `braze-cli`, deliberately: the same TypeScript, pnpm, Commander, Valibot and
Pino stack, the same separation between a portable core and the terminal, and the same rule that
in machine mode stdout carries data and nothing else. The half both commands share is being
extracted into [`CLI-Heaven/cli-core`](https://github.com/CLI-Heaven/cli-core) rather than copied.

Not the official MAX Bot API — this speaks the protocol a normal user account speaks, which is
unofficial and reverse engineered ([`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) §4).

Documentation index: [`docs/README.md`](docs/README.md).

## Licence

MIT.
