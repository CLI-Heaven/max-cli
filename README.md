# MAX CLI

A local command line interface for a normal personal [MAX Messenger](https://max.ru) account:
connect, run one operation, print the result, disconnect. Built for AI agents and scripts first
and for people second — every data command answers with stable JSON on request.

**Status 2026-09-20: it works, and it is not released.** Published one day as
`@cli-heaven/max-cli`; typed as `max`. Seven operations run against the real service —
`session start|end`, `account show`, `chats list`, `contacts list`, `messages list|send` — under
Node 22+ and Bun. Every request they send is declared once in `src/spec/`, and `max runs` reads
back what the tool did. Nothing is on npm yet. What it is meant to be, in the owner's own words, is
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md); how it is put together is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); what is left is
[`docs/BACKLOG.md`](docs/BACKLOG.md).

```sh
max session start                   # asks for a token; nothing is echoed, nothing is written to a file
max chats list --limit 5
max messages list 0 --json          # 0 was the Saved-messages dialog on the account this was measured on
max messages send 0 "a note to myself"
```

A chat is named by its id or by part of its title, and an ambiguous title is refused rather than
guessed at.

## Profiles and settings

**The first word is the profile whenever it is not a command.** There is no `--profile`.

```sh
max personal chats list             # the profile is `personal`
MAX_PROFILE=personal max chats list # the same, for a whole shell session
max chats list                      # the configured default, or `default`
```

A setting is decided in one order — **flag, then environment, then the configuration file, then
the built-in default.** The file is optional; without it everything has a default.

`~/.config/max-cli/config.json`:

```json
{
  "defaultProfile": "default",
  "profiles": {
    "default": { "limit": 20, "timeoutMs": 30000, "color": true }
  }
}
```

Every field is optional and **none of them can hold a secret** — no token, no phone number, no
chat id. The token lives in the OS keyring; the file only says how the tool behaves. A misspelled
field is refused by name rather than ignored, so a setting that seems to do nothing is a bug, not
a typo you have to find. The order, the traps and the two environment variables that outrank all
of it are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §14.

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
