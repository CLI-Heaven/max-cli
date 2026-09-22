import { Command } from "commander"
import { diagnose } from "../diagnose.js"
import { SessionStore } from "../session/store.js"
import { forCommand } from "./context.js"

/**
 * The state every other command depends on, read from disk and **never from MAX**.
 *
 * ⚠ **It must answer when everything is broken**, because that is the only time anybody runs it.
 * No session, no configuration file, a cache written by a newer `max`, a keyring that will not
 * open — each is a field in the answer and none is an exception. A diagnosis that fails with
 * `authentication_error` when asked "do I have a session" is worth nothing.
 *
 * It is a thin shell over `diagnose` on purpose: `forCommand` builds its own renderer over the
 * real streams, so anything left in here cannot be asserted on (`CLI-15`).
 *
 * `max config show` is the neighbouring half and does not overlap: that one reads what was
 * configured, this one reads what exists.
 */
export const doctorCommand = (): Command => {
  const command = new Command("doctor").description("the state this installation is in, without contacting MAX")

  command.action(async function (this: Command) {
    const { renderer, settings, format, run } = forCommand(this.optsWithGlobals())

    await run("doctor", async () => {
      const store = new SessionStore({ profile: settings.profile })
      const report = await diagnose({
        profile: settings.profile,
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

      renderer.result(format === "pretty" ? forPerson(report, settings.profile) : report)

      // ⚠ Said whenever the environment moved the keyring, because this is the one failure with no
      // other symptom: the profile is there, the login happened, and the answer is "no session".
      if (report.keyring.movedByEnvironment) {
        renderer.note(
          "MAX_CONFIG_DIR, MAX_STATE_DIR or MAX_CACHE_DIR is set, which changes the keyring entry — " +
            "a login done without them is invisible here, and the other way round",
        )
      }

      if (!report.cache.readable) {
        renderer.note(
          `the local copy was written by a newer max (schema ${report.cache.schemaVersion}, this one speaks ` +
            `${report.cache.speaks}) — commands still work, but the copy is ignored until \`max cache clear\``,
        )
      }

      if (!report.token.present) {
        renderer.note(`no token for this profile — \`max ${settings.profile} session start\` stores one`)
      }
    })
  })

  return command
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
  "profiles logged in": report.loggedInProfiles.length === 0 ? "none" : report.loggedInProfiles.join(", "),
  "local copy": report.cache.exists
    ? `schema ${report.cache.schemaVersion ?? "unreadable"}, this max speaks ${report.cache.speaks}`
    : "not created yet",
  runs: `${report.runs.kept} kept in ${report.runs.directory}`,
})
