<!-- Сгенерировано из дерева команд скриптом scripts/commands.ts. Не редактировать; `pnpm generate`. -->

# Команды

Справочник: каждая команда, каждая опция, каждый код возврата. Страница **собирается из самой
программы**, поэтому описать версию, которой не существует, она не может.

Как устроена строка:

```sh
max [профиль] [опции] <команда> <действие> [аргументы]
```

**Первое слово — профиль**, если оно не совпадает с именем команды: `max personal chats list`
читает чаты профиля `personal`, а `max chats list` — профиля по умолчанию. То же самое говорит
переменная `MAX_PROFILE`; без неё профиль называется `default`.

⚠ Описания команд и опций ниже — ровно те, что печатает `max --help`, то есть по-английски. Это
не недоработка перевода: текст живёт в программе, и второй его копии здесь быть не должно.

## Общие опции

Действуют на любую команду.

| Опция | Что делает |
|---|---|
| `-V, --version` | output the version number |
| `-v, --verbose` | more detail in what is shown: -v ids, -vv everything we know По умолчанию: `0`. |
| `--json` | machine-readable output: one JSON value on stdout, nothing else |
| `--jsonl` | machine-readable output: one JSON object per line, for streaming and jq |
| `--quiet` | diagnostics off |
| `--trace` | one line per request on stderr: ids and timings, never message content |
| `--timeout <duration>` | give up on the whole command after this — 30s, 2m, 500ms |
| `--offline` | answer from what was recorded and never connect; fails if nothing was |
| `--record` | keep this run under `max runs` — ids and timings, never message content |
| `--no-record` | do not keep it, whatever the configuration says |
| `--serve` | start `max serve` in the background if it is not running (the default) |
| `--no-serve` | do not start it; log in on this command's own connection unless one is running |

## `max session`

the stored MAX session for this profile

### `max session start`

log this profile in to MAX

```sh
max session start [method]
```

| Аргумент | | Что это |
|---|---|---|
| `method` | необязательный | token (pasted or piped), qr, qr-chrome or sms |

### `max session end`

forget the stored session for this profile

```sh
max session end
```

## `max account`

the account this profile is logged in as

### `max account show`

who this profile is logged in as; the phone number shows its last four digits

```sh
max account show [options]
```

| Опция | Что делает |
|---|---|
| `--show-phone` | print the whole phone number |

### `max account update`

change the name or the description everyone sees on your profile

**Меняет что-то в MAX.**

```sh
max account update [options]
```

| Опция | Что делает |
|---|---|
| `--first-name <name>` | your first name |
| `--last-name <name>` | your last name |
| `--description <text>` | about you |

### `max account sessions`

where else this account is logged in — not `max session`, which is this tool's own login

```sh
max account sessions
```

## `max chats`

the chats this account is in

### `max chats list`

the chats this account is in

```sh
max chats list [options]
```

| Опция | Что делает |
|---|---|
| `--limit <n>` | how many to show |
| `--page <n>` | which page, starting at 1 |
| `--all` | every row, no paging |
| `--search <text>` | only chats whose name contains this; at least 3 characters |
| `--kind <dialog\|group\|channel>` | only chats of this kind |
| `--unread` | only chats with unread messages |

### `max chats show`

one chat: its kind, unread count, last message time and who is in it

```sh
max chats show <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

### `max chats inspect`

what a link leads to, without joining it

```sh
max chats inspect <link>
```

| Аргумент | | Что это |
|---|---|---|
| `link` | обязательный | an invite link, https://max.ru/join/…, or a public one, https://max.ru/<name> |

### `max chats join`

join a group or channel by its link; the others in it see that you joined

**Меняет что-то в MAX.**

```sh
max chats join <link>
```

| Аргумент | | Что это |
|---|---|---|
| `link` | обязательный | an invite link, https://max.ru/join/…, or a public one, https://max.ru/<name> |

### `max chats read`

mark a chat read; the other person sees that you read it

**Меняет что-то в MAX.**

```sh
max chats read <chat> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

| Опция | Что делает |
|---|---|
| `--until <message>` | only up to this message id, inclusive; the newest by default |

### `max chats leave`

leave a group or channel; the others in it see that you left

**Меняет что-то в MAX.**

```sh
max chats leave <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

### `max chats create`

create a group; the people added are told

**Меняет что-то в MAX.**

```sh
max chats create <title> [person]
```

| Аргумент | | Что это |
|---|---|---|
| `title` | обязательный | the group's name |
| `person` | необязательный | people to add: an id, or part of a name |

### `max chats members`

add people to a group or channel, or remove them

```sh
max chats members
```

### `max chats admins`

give or take back a member's admin rights

```sh
max chats admins
```

### `max chats update`

rename a group or channel, or change its description

**Меняет что-то в MAX.**

```sh
max chats update <chat> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

| Опция | Что делает |
|---|---|
| `--title <title>` | the new name |
| `--description <text>` | the new description |

### `max chats settings`

a group's settings; with an option, change that one

**Меняет что-то в MAX.**

```sh
max chats settings <chat> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

| Опция | Что делает |
|---|---|
| `--all-can-pin <on\|off>` | every member may pin messages |
| `--only-admins-add <on\|off>` | only admins may add members |
| `--only-admins-call <on\|off>` | only admins may start a call |
| `--only-owner-edits-info <on\|off>` | only the owner may change the name and photo |
| `--members-see-link <on\|off>` | members may see the invite link |

### `max chats requests`

people asking to join a group or channel

```sh
max chats requests
```

### `max chats link`

a group's invite link

```sh
max chats link
```

### `max chats folders`

your chat folders

```sh
max chats folders
```

## `max contacts`

people you have a one-to-one chat with

### `max contacts list`

people you have a one-to-one chat with

```sh
max contacts list [options]
```

| Опция | Что делает |
|---|---|
| `--limit <n>` | how many to show |
| `--page <n>` | which page, starting at 1 |
| `--all` | every row, no paging |
| `--order <recent\|name>` | newest conversation first, or alphabetical |
| `--search <text>` | only people whose name or @username contains this; at least 3 characters |

### `max contacts show`

one person and the chats you share with them

```sh
max contacts show <person>
```

| Аргумент | | Что это |
|---|---|---|
| `person` | обязательный | person id, @username, or part of a name |

### `max contacts sync`

forget where the last sync left off and take the whole list again

```sh
max contacts sync
```

### `max contacts lookup`

who MAX has under a phone number — asks for it, or reads it from stdin

```sh
max contacts lookup
```

### `max contacts add`

add a person to your contacts — `contacts list` still shows only people you have a dialog with

**Меняет что-то в MAX.**

```sh
max contacts add <person>
```

| Аргумент | | Что это |
|---|---|---|
| `person` | обязательный | person id — `contacts lookup` finds one — or part of a known name |

### `max contacts remove`

remove a person from your contacts; the chat stays, a name you gave them may not

**Меняет что-то в MAX.**

```sh
max contacts remove <person>
```

| Аргумент | | Что это |
|---|---|---|
| `person` | обязательный | person id — `contacts lookup` finds one — or part of a known name |

### `max contacts import`

upload phone numbers to MAX and add the people it has under them

**Меняет что-то в MAX.**

```sh
max contacts import <file>
```

| Аргумент | | Что это |
|---|---|---|
| `file` | обязательный | one person per line: number, then a comma or a tab, then the name |

## `max messages`

read and send messages in a chat

### `max messages list`

recent messages in a chat, oldest first

```sh
max messages list <chat> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

| Опция | Что делает |
|---|---|
| `--limit <n>` | how many to read |
| `--before <id-or-time>` | read what came before this message id, or this ISO 8601 time |
| `--after <id-or-time>` | read what came after this message id, or this ISO 8601 time; not with --before |
| `--mark-read` | also mark the chat read up to the newest message shown; the other person sees it |

### `max messages search`

find messages in what this machine has already read

```sh
max messages search <text> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `text` | обязательный | what to look for; at least 3 characters |

| Опция | Что делает |
|---|---|
| `--chat <id>` | only this chat; an id, because searching never connects to resolve a name |
| `--limit <n>` | how many to show |

### `max messages show`

one message by its id

```sh
max messages show <chat> <message>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

### `max messages context`

a message and what came either side of it, oldest first

```sh
max messages context <chat> <message> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

| Опция | Что делает |
|---|---|
| `--before <n>` | how many before it По умолчанию: `5`. |
| `--after <n>` | how many after it По умолчанию: `5`. |

### `max messages download`

save a message's photos, files, videos and audio to a directory

```sh
max messages download <chat> <message> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

| Опция | Что делает |
|---|---|
| `--output <dir>` | where to save them По умолчанию: `.`. |

### `max messages transcribe`

turn a voice message into text, on this machine — the recording goes nowhere

```sh
max messages transcribe <chat> <message> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | id of a voice message |

| Опция | Что делает |
|---|---|
| `--model <id>` | which downloaded speech model to use; `max models audio list` shows them |

### `max messages send`

send one text message

**Меняет что-то в MAX.**

```sh
max messages send <chat> [text] [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `text` | необязательный | what to say; leave it off to read it from stdin, or to send only a file |

| Опция | Что делает |
|---|---|
| `--cid <n>` | reuse a client id from an earlier ambiguous send; MAX collapses the duplicate |
| `--silent` | deliver without a notification |
| `--reply-to <message>` | answer this message id in the same chat |
| `--file <path>` | attach a file; .jpg .png .webp .gif go as a photo. Repeat it for more than one |
| `--md, --markdown` | read **bold**, _italic_, ~~struck~~ and `code` in the text; \ keeps a mark literal |
| `--at <time>` | let MAX send it later, even with this machine off: 2026-09-25T09:00 (local time), or 30m, 2h, 1d from now |

### `max messages scheduled`

messages waiting to be sent later in a chat, soonest first; cancel one in the MAX app

```sh
max messages scheduled <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

### `max messages edit`

change the text of your own message; the other person may have read it already

**Меняет что-то в MAX.**

```sh
max messages edit <chat> <message> [text] [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | id of your own message |
| `text` | необязательный | the new text; leave it off to read it from stdin |

| Опция | Что делает |
|---|---|
| `--md, --markdown` | read **bold**, _italic_, ~~struck~~ and `code` in the text; \ keeps a mark literal |

### `max messages forward`

forward one message to another chat

**Меняет что-то в MAX.**

```sh
max messages forward <chat> <message> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | the chat the message is in: an id, or part of a chat name |
| `message` | обязательный | message id |

| Опция | Что делает |
|---|---|
| `--to <chat>` | the chat to forward it to: an id, or part of a chat name |
| `--cid <n>` | reuse a client id from an earlier ambiguous forward; MAX collapses the duplicate |
| `--silent` | deliver without a notification |

### `max messages pin`

pin a message in a chat; it replaces what was pinned

**Меняет что-то в MAX.**

```sh
max messages pin <chat> <message> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

| Опция | Что делает |
|---|---|
| `--notify` | tell the chat's members about the pin |

### `max messages unpin`

unpin whatever message is pinned in a chat

**Меняет что-то в MAX.**

```sh
max messages unpin <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

## `max models`

models that run on this machine

### `max models audio`

speech models for transcribing voice messages

```sh
max models audio
```

## `max reactions`

react to messages

### `max reactions add`

put your reaction on a message; it replaces the one you had

**Меняет что-то в MAX.**

```sh
max reactions add <chat> <message> <emoji>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |
| `emoji` | обязательный | one emoji, for example 👍 |

### `max reactions remove`

take your reaction off a message

**Меняет что-то в MAX.**

```sh
max reactions remove <chat> <message>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

## `max recipients`

the chats this profile may send to, when the list is on

### `max recipients list`

the chats on the list; empty and off until the first add

```sh
max recipients list
```

### `max recipients add`

allow sending to this chat; the first add turns the list on

```sh
max recipients add <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

### `max recipients remove`

stop allowing this chat; the list stays on

```sh
max recipients remove <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or the title as the list shows it |

### `max recipients off`

turn the list off: this profile may send to any chat again

```sh
max recipients off
```

## `max sends`

every attempt to send from this profile — never the text

### `max sends list`

attempts to send, newest first: sent, refused, failed, or not known

```sh
max sends list [options]
```

| Опция | Что делает |
|---|---|
| `--limit <n>` | how many to show По умолчанию: `20`. |

## `max inbox`

other people's unread messages in every chat; --new for what arrived since the last check

```sh
max inbox [options]
```

| Опция | Что делает |
|---|---|
| `--new` | what arrived since the last check, each message once — for scheduled runs |
| `--since <id-or-time>` | what arrived after this message id or ISO 8601 time; the saved point stays put |
| `--limit <n>` | at most this many per chat, the newest |

## `max serve`

stay connected to MAX and stream new messages to `max watch`, until Ctrl-C

```sh
max serve [options]
```

| Опция | Что делает |
|---|---|
| `--idle <duration>` | stop after this long with nobody using it — 15m, 1h is 60m |
| `--detach` | run in the background instead; still stopped only by `max serve --stop` |
| `--stop` | stop this profile's server, however it was started |

## `max watch`

print new messages as they arrive, from a running `max serve`

```sh
max watch
```

## `max config`

the settings in force, and where each one came from

### `max config show`

the profile, the profiles that exist, and each setting with where it came from

```sh
max config show
```

### `max config set`

save a setting to the configuration file

```sh
max config set <setting> <value> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `setting` | обязательный | one of: limit, timeoutMs, color, senderColors, record, keepRunsForDays, readOnly, sendsPerHour, serve, updateCheck, transcribeModel |
| `value` | обязательный | a number, true or false |

| Опция | Что делает |
|---|---|
| `--defaults` | change what every profile gets, rather than this profile |

### `max config unset`

remove a setting from the configuration file

```sh
max config unset <setting> [options]
```

| Аргумент | | Что это |
|---|---|---|
| `setting` | обязательный | one of: limit, timeoutMs, color, senderColors, record, keepRunsForDays, readOnly, sendsPerHour, serve, updateCheck, transcribeModel |

| Опция | Что делает |
|---|---|
| `--defaults` | change what every profile gets, rather than this profile |

## `max doctor`

the state this installation is in, without contacting MAX

```sh
max doctor
```

## `max cache`

the local copy of chats, contacts and messages

### `max cache clear`

forget everything this profile has cached

```sh
max cache clear
```

## `max runs`

recorded runs — what this tool did, and when

### `max runs list`

recorded runs, newest first

```sh
max runs list [options]
```

| Опция | Что делает |
|---|---|
| `--limit <n>` | how many to show По умолчанию: `20`. |

### `max runs show`

one run: what it was, and one line per request

```sh
max runs show <run-id>
```

| Аргумент | | Что это |
|---|---|---|
| `run-id` | обязательный | an id from `max runs list` |

### `max runs path`

the directory holding one run

```sh
max runs path <run-id>
```

| Аргумент | | Что это |
|---|---|---|
| `run-id` | обязательный | an id from `max runs list` |

## `max skill`

the instructions an agent is given for this tool

### `max skill show`

print SKILL.md — redirect it into ~/.claude/skills/max-cli/SKILL.md for Claude Code, or ~/.agents/skills/max-cli/SKILL.md for Codex and Gemini CLI

```sh
max skill show
```

## `max commands`

every command, option and exit code as JSON — what an agent reads instead of --help

```sh
max commands
```

## `max update`

update max with the package manager that installed it; --check only looks

```sh
max update [options]
```

| Опция | Что делает |
|---|---|
| `--check` | say whether a newer version exists, and install nothing |

## `max mcp`

serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add max -- max mcp`

```sh
max mcp [options]
```

| Опция | Что делает |
|---|---|
| `--allow-send` | offer the send tool; without it the server can only read |
| `--confirm-send` | show the owner each send in a form from the server — the chat it resolved to and the text |
| `--allow-mark-read` | offer the tool that marks a chat read; the other person sees it |

## Коды возврата

Скрипт ветвится по коду, а не по тексту: текст меняется, код — нет.

| Код | Когда |
|---|---|
| `0` | получилось |
| `2` | `validation_error` |
| `3` | `configuration_error` |
| `4` | `authentication_error` |
| `5` | `permission_error` |
| `6` | `not_found` |
| `7` | `confirmation_required` |
| `8` | `rate_limited` |
| `9` | `timeout` |
| `10` | `network_error` |
| `11` | `provider_error` |
| `12` | `provider_unavailable` |
| `13` | `invalid_response` |
| `14` | `outcome_unknown` |
| `130` | `cancelled` |
| `1` | всё остальное |

`0` и только `0` означает, что операция выполнена. `14` — `outcome_unknown` — означает, что
сообщение **могло** уйти: не отправлено и не провалено, и повторять его можно только с тем же
`--cid`.
