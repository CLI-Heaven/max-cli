import { existsSync } from "node:fs"
import { resolvePaths } from "@leemour/cli-core"
import { Command } from "commander"
import { configuredProfiles } from "../config.js"
import { forCommand } from "./context.js"

/**
 * What this installation decided, and where each piece of it came from.
 *
 * ⚠ **It is not a health check.** It reads files and prints what they say; it never opens the
 * cache, never touches the keyring and never contacts MAX. "Is my session alive" is a different
 * question with a different cost — a login — and it belongs to `max doctor` (`CLI-12`).
 *
 * Printing the whole configuration is safe by construction rather than by care: the schema has
 * nowhere to put a token, a phone number or a chat id (`src/config.ts`).
 */
export const configCommand = (): Command => {
  const command = new Command("config").description("the settings in force, and where they came from")

  command
    .command("show")
    .description("the settings in force, and where they came from")
    .action(async function (this: Command) {
      const { renderer, settings, format, run } = forCommand(this.optsWithGlobals())
      const paths = resolvePaths({ appName: "max-cli", prefix: "MAX", env: process.env })

      // It reaches nothing, so there is nothing to record — but a run is still how `--record`
      // keeps a trail of what was asked, and the wrapper costs nothing when nobody asked.
      await run("config show", async () => {
        const profiles = configuredProfiles()
        const report = {
          profile: { name: settings.profile, from: settings.profileFrom },
          configPath: settings.configPath,
          configExists: existsSync(settings.configPath),
          configuredProfiles: profiles,
          settings: {
            limit: settings.limit,
            timeoutMs: settings.timeoutMs ?? null,
            commandTimeoutMs: settings.commandTimeoutMs ?? null,
            color: settings.color ?? null,
            record: settings.record,
            keepRunsForDays: settings.keepRunsForDays,
          },
          paths: { config: paths.config, state: paths.state, cache: paths.cache },
        }

        // Nested for a machine, flat for a person. The pretty renderer prints one line per key and
        // does not descend, so handing it this shape would put a JSON blob on the row labelled
        // `settings` — which is the one row somebody ran this command to read.
        renderer.result(
          format === "pretty"
            ? {
                profile: `${settings.profile} (from ${settings.profileFrom})`,
                "configured profiles": profiles.length === 0 ? "none" : profiles.join(", "),
                "config file": `${settings.configPath}${report.configExists ? "" : " (not there yet)"}`,
                limit: settings.limit,
                "timeout, one request":
                  settings.timeoutMs === undefined ? "the transport's own" : `${settings.timeoutMs}ms`,
                "timeout, whole command":
                  settings.commandTimeoutMs === undefined ? "none" : `${settings.commandTimeoutMs}ms`,
                colour: settings.color === undefined ? "decided by the terminal" : settings.color,
                record: settings.record,
                "keep runs for": `${settings.keepRunsForDays} days`,
                state: paths.state,
                cache: paths.cache,
              }
            : report,
        )

        // Said every time rather than only when the list is empty: a short list is exactly as
        // misleading as an empty one, and neither looks wrong.
        renderer.note("profiles are listed from the configuration file; a profile can be logged in without being in it")
      })
    })

  return command
}
