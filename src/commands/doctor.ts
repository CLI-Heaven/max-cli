import { resolve } from "node:path"
import { writeSecurely } from "@leemour/cli-core"
import { Command } from "commander"
import { diagnose } from "../diagnose.js"
import { buildReport, mailtoFor, REPORT_ADDRESS, reportFileName } from "../report.js"
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
  const command = new Command("doctor").description("the state this installation is in, without contacting MAX")

  command.action(async function (this: Command) {
    const { renderer, settings, format, run, store } = forCommand(this)

    await run("doctor", async () => {
      const report = await diagnoseProfile(settings.profile, store)

      renderer.result(format === "pretty" ? forPerson(report, settings.profile) : report)

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
    })
  })

  command.addCommand(reportCommand())
  return command
}

const diagnoseProfile = (profile: string, store: SessionStore) =>
  diagnose({
    profile,
    // Reading the keyring is the one thing here that can prompt or hang on a locked keyring,
    // so its failure is "no token found" rather than a failed command.
    hasKeyringToken: () => {
      try {
        return store.readToken() !== undefined
      } catch {
        return false
      }
    },
  })

const INCLUDES = [
  "версия max, среда (node или bun) и система",
  "то же, что показывает `max doctor`; домашний каталог заменён на ~",
  "последний запуск, который кончился ошибкой: команда, запросы к MAX, коды ошибок, время",
  "последние 20 действий-записей (отправки, реакции, удаления): исход и номера, без текста",
]
const EXCLUDES = ["текстов сообщений", "названий чатов", "имён", "номеров телефонов", "токена"]

/**
 * **A report is sent by the person, not by `max`**: there is no server of ours, and a mail password
 * inside a public package is anybody's (`NEED-267`). So `create` writes a file and prints a
 * `mailto:` link and the steps; the person's own mail program does the sending.
 */
const reportCommand = (): Command => {
  const report = new Command("report").description("what a problem report holds and where it goes; writes nothing")

  report.action(function (this: Command) {
    const { renderer, format, streams } = forCommand(this)
    if (format !== "pretty") {
      renderer.result({
        sendTo: REPORT_ADDRESS,
        includes: INCLUDES,
        excludes: EXCLUDES,
        create: "max doctor report create",
      })
      return
    }
    streams.data(
      [
        `Отчёт о проблеме — один файл для автора max. Он отправляется письмом на ${REPORT_ADDRESS}.`,
        "",
        "В файле:",
        ...INCLUDES.map((line, index) => `- ${line}${index === INCLUDES.length - 1 ? "." : ";"}`),
        "",
        `В файле нет: ${EXCLUDES.join(", ")}.`,
        "Номера чатов и сообщений в нём есть: без вашего входа в MAX они ничего не дают, но это ваши чаты.",
        "",
        "Создать отчёт:             max doctor report create",
        "Про определённый запуск:   max doctor report create --run <id>   (номера — max runs list)",
      ].join("\n"),
    )
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

        const mailto = mailtoFor(built, path)
        const steps = [
          `Откройте ссылку: почтовая программа откроет письмо на ${REPORT_ADDRESS} с темой и заготовкой текста. Если ничего не открылось — напишите на этот адрес сами.`,
          `Приложите к письму файл ${path}.`,
          "Напишите, что делали, что ожидали и что случилось.",
          "Отправьте.",
        ]
        const noRun = built.run
          ? undefined
          : "Неудачных запусков не записано. Если проблема повторяется, повторите команду, которая не работает, и создайте отчёт снова: неудачный запуск сохранится сам."

        if (format !== "pretty") {
          renderer.result({ path, sendTo: REPORT_ADDRESS, mailto, run: built.run?.metadata.runId ?? null, steps })
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
            `   ${mailto}`,
            ...steps.slice(1).map((step, index) => `${index + 2}. ${step}`),
            "",
            "Перед отправкой файл можно открыть и посмотреть: текстов сообщений в нём нет.",
          ].join("\n"),
        )
      })
    })

  return report
}

/** One line per row: the pretty renderer prints a flat object and does not descend into one. */
const forPerson = (report: Awaited<ReturnType<typeof diagnose>>, profile: string) => ({
  profile,
  token: report.token.present ? `yes, from the ${report.token.from}` : "none",
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
})
