import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolvePaths } from "@leemour/cli-core"
import type { FetchLike } from "@leemour/cli-core/http"
import {
  checkIsDue,
  type Installer,
  installerOf,
  isNewer,
  latestVersion,
  mayNotify,
  readUpdateState,
  writeUpdateState,
} from "@leemour/cli-core/update"
import { resolveSettings } from "./config.js"
import { VERSION } from "./version.js"

export const PACKAGE = "@leemour/max-cli"

/** npm, the clock, the terminal and the package manager as `max update` sees them — faked in a test. */
export interface UpdateEnvironment {
  fetch?: FetchLike
  now?: () => number
  stderrIsTTY?: boolean
  scriptPath?: string
  /** Runs the update and answers its exit code; its output goes to stderr. */
  spawn?: (argv: string[]) => number
}

export const installer = ({ scriptPath }: UpdateEnvironment = {}): Installer =>
  installerOf(scriptPath ?? realpathSync(fileURLToPath(import.meta.url)))

export const latest = (environment: UpdateEnvironment = {}) =>
  latestVersion(PACKAGE, environment.fetch ?? fetch, { timeoutMs: 3000 })

/** stdout stays one result: whatever the package manager prints goes to stderr. */
export const runUpdate = ([command, ...args]: string[], environment: UpdateEnvironment = {}): number =>
  environment.spawn?.([command as string, ...args]) ??
  spawnSync(command as string, args, { stdio: ["inherit", 2, 2] }).status ??
  1

const statePath = (env: NodeJS.ProcessEnv) =>
  join(resolvePaths({ appName: "max-cli", prefix: "MAX", env }).state, "update-check.json")

/**
 * The daily "a newer version exists" line, or `undefined`. Started beside the command and awaited
 * after it, so asking npm costs the command nothing; any failure is silence, never an error.
 */
export const updateNotice = async (
  argv: readonly string[],
  {
    tty,
    environment = {},
    env = process.env,
  }: { tty?: boolean; environment?: UpdateEnvironment; env?: NodeJS.ProcessEnv },
): Promise<string | undefined> => {
  try {
    const [command] = argv.filter((word) => !word.startsWith("-"))
    if (command === "complete" || command === "update") return undefined

    const settings = resolveSettings({}, { env })
    const pretty = !argv.includes("--json") && !argv.includes("--jsonl") && (tty ?? process.stdout.isTTY === true)
    const told = mayNotify({
      format: pretty ? "pretty" : "json",
      stderrIsTTY: environment.stderrIsTTY ?? process.stderr.isTTY === true,
      quiet: argv.includes("--quiet"),
      enabled: settings.updateCheck,
      installer: installer(environment),
      env,
      offVariables: ["MAX_NO_UPDATE_CHECK"],
    })
    if (!told) return undefined

    const path = statePath(env)
    const now = (environment.now ?? Date.now)()
    let state = readUpdateState(path)
    if (checkIsDue(state, now)) {
      const found = await latestVersion(PACKAGE, environment.fetch ?? fetch, { timeoutMs: 1000 })
      const seen = found ?? state?.latest
      state = seen ? { checkedAt: now, latest: seen } : { checkedAt: now }
      writeUpdateState(path, state)
    }

    return state?.latest && isNewer(state.latest, VERSION)
      ? `max ${state.latest} is out — you have ${VERSION}. \`max update\` installs it.`
      : undefined
  } catch {
    return undefined
  }
}
