import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { CliError, pathsAreOverridden, resolvePaths } from "@leemour/cli-core"
import { Command } from "commander"
import { ALL_SETTINGS, changeSetting, type SourcedSetting } from "../config.js"
import { forCommand } from "./context.js"

const SHOWN: SourcedSetting[] = [
  "limit",
  "timeoutMs",
  "commandTimeoutMs",
  "color",
  "senderColors",
  "record",
  "serve",
  "keepRunsForDays",
  "readOnly",
  "allow",
  "sendsPerHour",
  "updateCheck",
]

export const configCommand = (): Command => {
  const command = new Command("config").description("the settings in force, and where each one came from")

  /**
   * Printed whole: no field the configuration accepts can hold a secret (`src/config.ts`). Whether
   * a profile has a token is not here — reading the keyring is `max doctor`'s (`CLI-12`).
   */
  command
    .command("show")
    .description("the profile, the profiles that exist, and each setting with where it came from")
    .action(function (this: Command) {
      const { settings, renderer } = forCommand(this)
      const overridden = pathsAreOverridden({ appName: "max-cli", prefix: "MAX" })

      renderer.result({
        profile: settings.profile,
        profileFrom: settings.sources.profile,
        profiles: [...new Set([...settings.configuredProfiles, ...profilesWithState()])].sort(),
        configFile: settings.configPath,
        configFound: settings.configFound,
        pathsOverridden: overridden,
        settings: SHOWN.map((setting) => ({
          setting,
          // No list is every action, and `null` would read as none.
          value: setting === "allow" ? (settings.allow ?? "all") : (settings[setting] ?? null),
          from: settings.sources[setting],
        })),
      })

      if (overridden) {
        renderer.note(
          "MAX_CONFIG_DIR, MAX_STATE_DIR or MAX_CACHE_DIR is set — a profile's keyring entry is not the usual one, " +
            "so a session made without them reads as none",
        )
      }
    })

  for (const action of ["set", "unset"] as const) {
    const sub = command
      .command(action)
      .argument("<setting>", `one of: ${ALL_SETTINGS.join(", ")}`)
      .option("--defaults", "change what every profile gets, rather than this profile")
    if (action === "set")
      sub
        .argument("<value>", "a number, true or false, or for allow a list like send,reaction")
        .description("save a setting to the configuration file")
    else sub.description("remove a setting from the configuration file")

    sub.action(function (this: Command, setting: string, given: unknown) {
      const value = action === "set" ? String(given) : undefined
      const { settings, renderer } = forCommand(this)
      const defaults = this.opts<{ defaults?: boolean }>().defaults === true
      if (defaults && process.env.MAX_PROFILE_LOCK) {
        // The defaults are every other profile's settings too.
        throw new CliError(
          "permission_error",
          `this process is locked to profile ${settings.profile} (MAX_PROFILE_LOCK) — --defaults changes every profile`,
        )
      }
      const saved = changeSetting(settings.configPath, {
        profile: defaults ? undefined : settings.profile,
        setting,
        value,
      })
      renderer.result({
        configFile: settings.configPath,
        scope: defaults ? "defaults" : `profiles.${settings.profile}`,
        setting,
        value: saved,
      })
    })
  }

  return command
}

const profilesWithState = (): string[] => {
  const dir = join(resolvePaths({ appName: "max-cli", prefix: "MAX" }).state, "profiles")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
}
