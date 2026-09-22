import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { pathsAreOverridden, resolvePaths } from "@leemour/cli-core"
import { Command } from "commander"
import type { SourcedSetting } from "../config.js"
import { forCommand } from "./context.js"

const SHOWN: SourcedSetting[] = [
  "limit",
  "timeoutMs",
  "commandTimeoutMs",
  "color",
  "senderColors",
  "record",
  "keepRunsForDays",
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
      const { settings, renderer } = forCommand(this.optsWithGlobals())
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
          value: settings[setting] ?? null,
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

  return command
}

const profilesWithState = (): string[] => {
  const dir = join(resolvePaths({ appName: "max-cli", prefix: "MAX" }).state, "profiles")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
}
