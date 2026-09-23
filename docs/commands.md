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

## `max session`

the stored MAX session for this profile
### `max session start`

store a MAX session for this profile

```sh
max session start [options]
```

### `max session end`

forget the stored session for this profile

```sh
max session end [options]
```

## `max account`

the account this profile is logged in as
### `max account show`

who this profile is logged in as

```sh
max account show [options]
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
max chats show [options] <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

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
max contacts show [options] <person>
```

| Аргумент | | Что это |
|---|---|---|
| `person` | обязательный | person id, @username, or part of a name |

### `max contacts sync`

forget where the last sync left off and take the whole list again

```sh
max contacts sync [options]
```

## `max messages`

read and send messages in a chat
### `max messages list`

recent messages in a chat, oldest first

```sh
max messages list [options] <chat>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |

| Опция | Что делает |
|---|---|
| `--limit <n>` | how many to read |
| `--before <id-or-time>` | read what came before this message id, or this ISO 8601 time |
| `--after <id-or-time>` | read what came after this message id, or this ISO 8601 time; not with --before |

### `max messages search`

find messages in what this machine has already read

```sh
max messages search [options] <text>
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
max messages show [options] <chat> <message>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

### `max messages context`

a message and what came either side of it, oldest first

```sh
max messages context [options] <chat> <message>
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
max messages download [options] <chat> <message>
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `message` | обязательный | message id |

| Опция | Что делает |
|---|---|
| `--output <dir>` | where to save them По умолчанию: `.`. |

### `max messages send`

send one text message

```sh
max messages send [options] <chat> [text]
```

| Аргумент | | Что это |
|---|---|---|
| `chat` | обязательный | chat id, or part of a chat name |
| `text` | необязательный | what to say; leave it off to read the message from stdin |

| Опция | Что делает |
|---|---|
| `--cid <n>` | reuse a client id from an earlier ambiguous send; MAX collapses the duplicate |
| `--silent` | deliver without a notification |

## `max config`

the settings in force, and where each one came from
### `max config show`

the profile, the profiles that exist, and each setting with where it came from

```sh
max config show [options]
```

## `max doctor`

the state this installation is in, without contacting MAX

## `max cache`

the local copy of chats, contacts and messages
### `max cache clear`

forget everything this profile has cached

```sh
max cache clear [options]
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
max runs show [options] <run-id>
```

| Аргумент | | Что это |
|---|---|---|
| `run-id` | обязательный | an id from `max runs list` |

### `max runs path`

the directory holding one run

```sh
max runs path [options] <run-id>
```

| Аргумент | | Что это |
|---|---|---|
| `run-id` | обязательный | an id from `max runs list` |

## `max skill`

the instructions an agent is given for this tool
### `max skill show`

print SKILL.md — `max skill show > ~/.claude/skills/max-cli/SKILL.md` installs it

```sh
max skill show [options]
```

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
