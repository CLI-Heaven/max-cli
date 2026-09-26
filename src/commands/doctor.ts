import { resolve } from "node:path"
import { CliError, type Renderer, type RenderFormat, type Streams, writeSecurely } from "@leemour/cli-core"
import { Command } from "commander"
import { type Diagnosis, diagnose } from "../diagnose.js"
import { ownScript } from "../install.js"
import { checkOnline, mcpHandshake } from "../online.js"
import { buildReport, issueUrlFor, REPORT_URL, reportFileName } from "../report.js"
import { runsDirFor } from "../runs/run.js"
import { SendJournal, sendsPathFor } from "../sends/journal.js"
import type { SessionStore } from "../session/store.js"
import { forCommand } from "./context.js"

/**
 * The state every other command depends on, read from disk and **never from MAX**.
 *
 * ⚠ **It must answer when everything is broken**, because that is the only time anybody runs it.
 * No session, no configuration file, a cache written by a newer `max`, a keyring that will not
 * open — each is a field in the answer and none is an exception. A diagnosis that fails with
 * `authentication_error` when asked "do I have a session" is worth nothing.
 *
 * It is a thin shell over `diagnose` on purpose: the gathering is worth asserting on field by
 * field, and a command body is a worse place to do that from than a function that takes its
 * environment as arguments.
 *
 * `max config show` is the neighbouring half and does not overlap: that one reads what was
 * configured, this one reads what exists.
 */
export const doctorCommand = (): Command => {
  const command = new Command("doctor")
    .description("the state this installation is in, without contacting MAX unless --online")
    .option("--online", "also log in once, read one chat and start the MCP server; sends nothing")

  command.action(async function (this: Command) {
    const { online } = this.opts<{ online?: boolean }>()
    const { renderer, settings, format, run, store, createClient } = forCommand(this)

    await run("doctor", async (events) => {
      const report = await diagnoseProfile(settings.profile, store, settings.transcribeModel)
      const checks = online
        ? await checkOnline(createClient({ events }), () =>
            mcpHandshake({
              execPath: process.execPath,
              scriptPath: ownScript(),
              env: { ...process.env, MAX_PROFILE: settings.profile },
            }),
          )
        : undefined

      renderer.result(
        format === "pretty"
          ? { ...forPerson(report, settings.profile), ...(checks ? checksForPerson(checks) : {}) }
          : { ...report, ...(checks ? { online: checks } : {}) },
      )

      installNotes(report, renderer.note.bind(renderer))
      // ⚠ Said whenever the environment moved the keyring, because this is the one failure with no
      // other symptom: the profile is there, the login happened, and the answer is "no session".
      if (report.keyring.movedByEnvironment) {
        renderer.note(
          "MAX_CONFIG_DIR, MAX_STATE_DIR or MAX_CACHE_DIR is set, which changes the keyring entry — " +
            "a login done without them is invisible here, and the other way round",
        )
      }

      if (report.client.stale) {
        renderer.note(
          `the web client version max presents (${report.client.appVersion}) was read ${report.client.ageDays} days ago — ` +
            "MAX may refuse it; update max, or report it if this is the latest",
        )
      }

      if (!report.cache.readable) {
        renderer.note(
          `the local copy was written by a newer max (schema ${report.cache.schemaVersion}, this one speaks ` +
            `${report.cache.speaks}) — commands still work, but the copy is ignored until \`max cache clear\``,
        )
      }

      if (report.session.loginPausedUntil) {
        renderer.note(
          `MAX refused the last login for too many attempts — no login before ${report.session.loginPausedUntil}; wait`,
        )
      }

      if (!report.token.present && ((report.session.logins ?? 0) > 0 || report.session.viewerId)) {
        renderer.note(
          "no token, although this profile has logged in here — the keyring is probably out of reach " +
            "(cron, ssh: set XDG_RUNTIME_DIR). Log in again only if the token was removed",
        )
      } else if (!report.token.present) {
        renderer.note(`no token for this profile — \`max ${settings.profile} session start\` stores one`)
      }

      const failed = checks?.filter((check) => !check.ok).map((check) => check.name) ?? []
      if (failed.length > 0) throw new CliError("provider_error", `the online check failed: ${failed.join(", ")}`)
    })
  })

  command.addCommand(reportCommand())
  return command
}

const diagnoseProfile = (profile: string, store: SessionStore, speechModel?: string) =>
  diagnose({
    profile,
    ...(speechModel === undefined ? {} : { speechModel }),
    // Reading the keyring is the one thing here that can prompt or hang on a locked keyring,
    // so its failure is "no token found" rather than a failed command.
    storedToken: () => {
      try {
        const source = store.tokenSource()
        return source === "keyring" || source === "file" ? source : undefined
      } catch {
        return undefined
      }
    },
  })

const INCLUDES = [
  "версия max, среда (node или bun) и система",
  "то же, что показывает `max doctor`; домашний каталог заменён на ~",
  "последний запуск, который кончился ошибкой: команда, запросы к MAX, коды ошибок, время",
  "последние 20 действий-записей (отправки, реакции, удаления): исход, без текста",
  "вместо номеров чатов и сообщений — метки: одинаковые внутри отчёта и разные в каждом новом",
]
const EXCLUDES = ["текстов сообщений", "названий чатов", "имён", "номеров телефонов", "токена"]

/**
 * **A report is posted by the person, not by `max`**: there is no server of ours, and `max` holds
 * no GitHub credentials. So `create` writes a file and prints a pre-filled new-issue link and the
 * steps (`NEED-267`).
 */
const reportCommand = (): Command => {
  const report = new Command("report").description("what a problem report holds and where it goes; writes nothing")

  report.action(async function (this: Command) {
    const { renderer, format, streams, run } = forCommand(this)
    await run("doctor report", async () => explain(renderer, format, streams))
  })

  report
    .command("create")
    .description("write a problem report to a file, and print how to send it")
    .option("--run <id>", "the run the report is about; the newest failed one if not given")
    .option("--output <file>", "where to write it; a new file in this directory if not given")
    .action(async function (this: Command) {
      const options = this.opts<{ run?: string; output?: string }>()
      const { renderer, settings, format, streams, run, store } = forCommand(this)

      await run("doctor report create", async () => {
        const now = new Date()
        const built = buildReport({
          profile: settings.profile,
          doctor: await diagnoseProfile(settings.profile, store),
          runsDir: runsDirFor(),
          ...(options.run === undefined ? {} : { runId: options.run }),
          sends: new SendJournal(sendsPathFor(settings.profile)).entries(),
          now,
        })
        const path = resolve(options.output ?? reportFileName(now))
        writeSecurely(path, `${JSON.stringify(built, null, 2)}\n`, 0o600)

        const issue = issueUrlFor(built, path)
        const steps = [
          `Откройте ссылку: GitHub откроет новую задачу с заголовком и заготовкой текста. Нужен аккаунт на GitHub.`,
          `Перетащите в поле текста файл ${path} — GitHub приложит его.`,
          "Напишите, что делали, что ожидали и что случилось.",
          "Нажмите «Submit new issue». Задача будет видна всем.",
        ]
        const noRun = built.run
          ? undefined
          : "Неудачных запусков не записано. Если проблема повторяется, повторите команду, которая не работает, и создайте отчёт снова: неудачный запуск сохранится сам."

        if (format !== "pretty") {
          renderer.result({ path, sendTo: REPORT_URL, issue, run: built.run?.metadata.runId ?? null, steps })
          if (noRun) renderer.note(noRun)
          return
        }
        streams.data(
          [
            `Отчёт записан: ${path}`,
            ...(built.run ? [`Запуск в отчёте: ${built.run.metadata.runId} (${built.run.metadata.command})`] : [noRun]),
            "",
            "Что сделать:",
            `1. ${steps[0]}`,
            `   ${issue}`,
            ...steps.slice(1).map((step, index) => `${index + 2}. ${step}`),
            "",
            "Перед отправкой файл можно открыть и посмотреть: в нём нет текстов сообщений, а вместо номеров чатов и",
            "сообщений — метки.",
          ].join("\n"),
        )
      })
    })

  return report
}

const explain = (renderer: Renderer, format: RenderFormat, streams: Streams): void => {
  if (format !== "pretty") {
    renderer.result({
      sendTo: REPORT_URL,
      includes: INCLUDES,
      excludes: EXCLUDES,
      create: "max doctor report create",
    })
    return
  }
  streams.data(
    [
      "Отчёт о проблеме — один файл для автора max. Он прикладывается к новой задаче на GitHub.",
      "",
      "В файле:",
      ...INCLUDES.map((line, index) => `- ${line}${index === INCLUDES.length - 1 ? "." : ";"}`),
      "",
      `В файле нет: ${EXCLUDES.join(", ")}.`,
      "Задачи на GitHub видны всем — и приложенный файл тоже.",
      "",
      "Создать отчёт:             max doctor report create",
      "Про определённый запуск:   max doctor report create --run <id>   (номера — max runs list)",
    ].join("\n"),
  )
}

const TOKEN_FROM = {
  environment: "MAX_TOKEN",
  keyring: "the keyring",
  file: "credentials.json — there is no keyring here",
  none: "nowhere",
} as const

/**
 * What is wrong with how `max` is installed, and the exact command that fixes it. The fix is for
 * this platform's shell only: PowerShell on Windows, sh elsewhere.
 */
export const installNotes = ({ install, native }: Diagnosis, note: (message: string) => void): void => {
  if (install.fix.length > 0) {
    note(
      `the max command is in ${install.binDir}, which is not on PATH — a new terminal will not find it. Run:\n` +
        install.fix.map((line) => `  ${line}`).join("\n") +
        (install.fix.length > 1
          ? "\nThe first line fixes this window, the second every new one; then open a new terminal"
          : "\nand add that line to your shell's startup file (~/.zshrc or ~/.bashrc)"),
    )
  }
  if (install.onPath !== null && install.isMaxCli === false) {
    note(`\`max\` on PATH is ${install.onPath}, another program — call this one by its full path, or put it first`)
  }
  if (install.installer === "npx" && install.onPath === null) {
    note(
      "running through npx, and there is no `max` command on PATH — `npm install -g @leemour/max-cli` installs " +
        "one; if `max` is still not found after that, `npm prefix -g` names the folder PATH needs",
    )
  }
  if (native.keyring !== "ok") note(`the keyring module does not load (${native.keyring}) — the token goes into a file`)
  if (native.sqlite !== "ok") note(`SQLite does not open (${native.sqlite}) — max needs Node 22 or newer, or Bun 1.3`)
}

const checksForPerson = (checks: Awaited<ReturnType<typeof checkOnline>>) =>
  Object.fromEntries(checks.map(({ name, ok, detail }) => [`online: ${name}`, `${ok ? "ok" : "FAILED"} — ${detail}`]))

/** One line per row: the pretty renderer prints a flat object and does not descend into one. */
const forPerson = (report: Diagnosis, profile: string) => ({
  profile,
  token: report.token.present ? `yes, from ${TOKEN_FROM[report.token.from]}` : "none",
  keyring: report.keyring.movedByEnvironment
    ? `${report.keyring.service} (moved by the environment)`
    : report.keyring.service,
  "logged in": report.session.exists
    ? `${report.session.logins ?? 0} time(s)${report.session.lastLoginAt ? `, last ${report.session.lastLoginAt}` : ""}`
    : "never on this machine",
  "account known": report.session.viewerId,
  ...(report.session.loginPausedUntil ? { "login paused until": report.session.loginPausedUntil } : {}),
  "presents as": `web client ${report.client.appVersion}, ${report.client.chrome}, read ${report.client.readOn} (${report.client.ageDays} days ago)`,
  "profiles logged in": report.loggedInProfiles.length === 0 ? "none" : report.loggedInProfiles.join(", "),
  "local copy": report.cache.exists
    ? `schema ${report.cache.schemaVersion ?? "unreadable"}, this max speaks ${report.cache.speaks}`
    : "not created yet",
  runs: `${report.runs.kept} kept in ${report.runs.directory}`,
  runtime: `${report.install.runtime.version}, ${report.install.runtime.path}`,
  "installed by": report.install.installer,
  "max on PATH":
    report.install.onPath === null
      ? "not found"
      : `${report.install.onPath}${report.install.isMaxCli === false ? " — another program" : ""}`,
  "speech model": `${report.speech.model}, ${report.speech.downloaded ? "downloaded" : "not downloaded"}`,
})
