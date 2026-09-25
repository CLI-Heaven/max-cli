/**
 * Writes `docs/commands.md` from the command tree itself (`OPS-10`).
 *
 *   pnpm generate
 *
 * **Nobody writes that page by hand.** A reference that can be forgotten lies with the confidence
 * of a real one, and the person it lies to is the one who cannot read the source. `pnpm generate`
 * rewrites it and CI asserts the tree did not change, exactly as it does for `protocol.md`.
 *
 * It imports from `dist/` for the same reason `generate.ts` does: Node's type stripping will not
 * resolve a `.js` specifier to a `.ts` file, so `pnpm generate` builds first.
 *
 * ⚠ **The page's own words are Russian; everything quoted out of the program is English**
 * (`NEED-108`). Option and command descriptions are reproduced exactly as `max --help` prints
 * them — translating them here would give the same sentence two homes, and the one on screen
 * would be the one nobody corrected.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { EXIT_CODES } from "@leemour/cli-core"
import {
  type ArgumentInfo,
  type CommandInfo,
  describeOptions,
  describeProgram,
  type OptionInfo,
} from "@leemour/cli-core/commands"
import { createProgram } from "../dist/program.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const BANNER =
  "<!-- Сгенерировано из дерева команд скриптом scripts/commands.ts. Не редактировать; `pnpm generate`. -->"

/** A cell that will not break the table it sits in. */
const cell = (text: string | undefined): string => (text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim()

const optionRows = (options: readonly OptionInfo[]): string =>
  options
    .map((option) => {
      const fallback =
        option.default === undefined || option.default === false ? "" : ` По умолчанию: \`${String(option.default)}\`.`
      // The flags go through `cell` too: `--order <recent|name>` would otherwise split the row
      // into three, which is the first option here with a pipe in it and will not be the last.
      return `| \`${cell(option.flags)}\` | ${cell(option.description)}${fallback} |`
    })
    .join("\n")

const argumentRows = (args: readonly ArgumentInfo[]): string =>
  args
    .map(
      (argument) =>
        `| \`${cell(argument.name)}\` | ${argument.required ? "обязательный" : "необязательный"} | ${cell(argument.description)} |`,
    )
    .join("\n")

/** How one runnable command is typed, what it takes, what it accepts. */
const body = (command: CommandInfo): string[] => {
  const parts = [cell(command.description), ""]
  if (command.mutates) parts.push("**Меняет что-то в MAX.**", "")
  parts.push("```sh", command.usage, "```")

  if (command.arguments.length > 0) {
    parts.push("", "| Аргумент | | Что это |", "|---|---|---|", argumentRows(command.arguments))
  }
  if (command.options.length > 0) {
    parts.push("", "| Опция | Что делает |", "|---|---|", optionRows(command.options))
  }
  return parts
}

const action = (command: CommandInfo): string =>
  [`### \`max ${command.path.join(" ")}\``, "", ...body(command)].join("\n")

/** A resource and its actions — or, for a command with no actions of its own, the command itself. */
const resource = (command: CommandInfo): string =>
  command.commands.length === 0
    ? [`## \`max ${command.name}\``, "", ...body(command)].join("\n")
    : [`## \`max ${command.name}\``, "", cell(command.description), "", command.commands.map(action).join("\n\n")]
        .join("\n")
        .trimEnd()

const exitCodes = (): string =>
  [
    "| Код | Когда |",
    "|---|---|",
    "| `0` | получилось |",
    ...Object.entries(EXIT_CODES).map(([name, code]) => `| \`${code}\` | \`${name}\` |`),
    "| `1` | всё остальное |",
  ].join("\n")

const page = (program: ReturnType<typeof createProgram>): string => {
  const resources = describeProgram(program)

  return `${BANNER}

# Команды

Справочник: каждая команда, каждая опция, каждый код возврата. Страница **собирается из самой
программы**, поэтому описать версию, которой не существует, она не может.

Как устроена строка:

\`\`\`sh
max [профиль] [опции] <команда> <действие> [аргументы]
\`\`\`

**Первое слово — профиль**, если оно не совпадает с именем команды: \`max personal chats list\`
читает чаты профиля \`personal\`, а \`max chats list\` — профиля по умолчанию. То же самое говорит
переменная \`MAX_PROFILE\`; без неё профиль называется \`default\`.

⚠ Описания команд и опций ниже — ровно те, что печатает \`max --help\`, то есть по-английски. Это
не недоработка перевода: текст живёт в программе, и второй его копии здесь быть не должно.

## Общие опции

Действуют на любую команду.

| Опция | Что делает |
|---|---|
${optionRows(describeOptions(program))}

${resources.map(resource).join("\n\n")}

## Коды возврата

Скрипт ветвится по коду, а не по тексту: текст меняется, код — нет.

${exitCodes()}

\`0\` и только \`0\` означает, что операция выполнена. \`14\` — \`outcome_unknown\` — означает, что
сообщение **могло** уйти: не отправлено и не провалено, и повторять его можно только с тем же
\`--cid\`.
`
}

const path = join(root, "docs/commands.md")
writeFileSync(path, page(createProgram()))

execFileSync("pnpm", ["exec", "biome", "check", "--write", "--no-errors-on-unmatched", "docs/commands.md"], {
  cwd: root,
  stdio: "ignore",
  // pnpm is a .cmd script on Windows, which only a shell starts.
  shell: process.platform === "win32",
})

console.log("generated docs/commands.md from the command tree")
