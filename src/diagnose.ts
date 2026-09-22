import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { pathsAreOverridden, resolvePaths } from "@leemour/cli-core"
import { openCache } from "./cache/open.js"
import { SCHEMA_VERSION } from "./cache/schema.js"

export interface DiagnoseOptions {
  profile: string
  env?: NodeJS.ProcessEnv
  /** Tests point these at a temporary directory; nothing else should need them. */
  stateDir?: string
  cacheDir?: string
  /** Injected so a test needs no SQLite file and no keyring. */
  readSchemaVersion?: (file: string) => Promise<number | undefined>
  hasKeyringToken?: (profile: string) => boolean
}

export type TokenSource = "environment" | "keyring" | "none"

export interface Diagnosis {
  /** ⚠ Never the token, and never a prefix or a length of it — only whether one is reachable. */
  token: { present: boolean; from: TokenSource }
  /**
   * ⚠ **The trap this command exists for.** `MAX_CONFIG_DIR` and its two siblings change the
   * keyring entry a profile means, so a login performed with them set answers "no session"
   * without them — and nothing else in the tool can show that.
   */
  keyring: { service: string; movedByEnvironment: boolean }
  session: {
    stateFile: string
    /** `false` on a machine nobody has logged in on. Reading it must not create it. */
    exists: boolean
    deviceId: boolean
    viewerId: boolean
    /** What `RISK-2` wants counted: a token that stops working can then be explained. */
    logins: number | null
    lastLoginAt: string | null
  }
  loggedInProfiles: string[]
  cache: {
    file: string
    exists: boolean
    /** What is written in the file, which is not always what this build speaks. */
    schemaVersion: number | undefined
    speaks: number
    /** A file from a newer `max` is refused rather than written to — and that looks like a bug. */
    readable: boolean
  }
  runs: { directory: string; kept: number }
}

/**
 * Everything a command depends on, read from disk and **never from MAX**.
 *
 * It is a separate function rather than the body of the command because `forCommand` builds its
 * own renderer over the real streams, so anything left inside a command action cannot be asserted
 * on (`CLI-15`, and `src/session/adopt.ts` moved for the same reason).
 *
 * ⚠ **It must work when everything is broken**, which is the only time anybody runs it: no
 * session, no configuration file, a cache from a newer version, a keyring that will not open. Each
 * of those is a field in the answer, never an exception.
 *
 * ⚠ **It reads the state file directly instead of calling `readState`**, which invents a device
 * identity and writes it out on first read. A diagnosis that creates the thing it is reporting on
 * is not a diagnosis.
 */
export const diagnose = async ({
  profile,
  env = process.env,
  stateDir,
  cacheDir,
  readSchemaVersion = schemaVersionOf,
  hasKeyringToken = () => false,
}: DiagnoseOptions): Promise<Diagnosis> => {
  const paths = resolvePaths({ appName: "max-cli", prefix: "MAX", env })
  const state = stateDir ?? paths.state
  const cacheHome = cacheDir ?? paths.cache

  const moved = pathsAreOverridden({ appName: "max-cli", prefix: "MAX", env })
  const fromEnvironment = (env.MAX_TOKEN ?? "").trim() !== ""
  const inKeyring = fromEnvironment ? false : hasKeyringToken(profile)

  const stateFile = join(state, "profiles", `${profile}.json`)
  const stored = readState(stateFile)

  const cacheFile = join(cacheHome, `${profile}.db`)
  const cacheExists = existsSync(cacheFile)
  const schemaVersion = cacheExists ? await readSchemaVersion(cacheFile) : undefined

  const runsDirectory = join(state, "runs")

  return {
    token: {
      present: fromEnvironment || inKeyring,
      from: fromEnvironment ? "environment" : inKeyring ? "keyring" : "none",
    },
    keyring: { service: moved ? `max-cli:${paths.config}` : "max-cli", movedByEnvironment: moved },
    session: {
      stateFile,
      exists: stored !== undefined,
      deviceId: typeof stored?.deviceId === "string" && stored.deviceId !== "",
      viewerId: typeof stored?.viewerId === "string" && stored.viewerId !== "",
      logins: typeof stored?.logins === "number" ? stored.logins : null,
      lastLoginAt: typeof stored?.lastLoginAt === "string" ? stored.lastLoginAt : null,
    },
    loggedInProfiles: profilesWithState(join(state, "profiles")),
    cache: {
      file: cacheFile,
      exists: cacheExists,
      schemaVersion,
      speaks: SCHEMA_VERSION,
      readable: !cacheExists || (schemaVersion !== undefined && schemaVersion <= SCHEMA_VERSION),
    },
    runs: { directory: runsDirectory, kept: countEntries(runsDirectory) },
  }
}

/** A file that is missing, unreadable or not JSON is "no session", never a thrown error. */
const readState = (file: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * **Which profiles have been logged in**, which is not the same list as the configured ones —
 * `config show` says so and cannot answer it, because a profile needs no configuration entry.
 */
const profilesWithState = (directory: string): string[] => {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort()
  } catch {
    return []
  }
}

const countEntries = (directory: string): number => {
  try {
    return readdirSync(directory).filter((name) => statSync(join(directory, name)).isDirectory()).length
  } catch {
    return 0
  }
}

/**
 * The schema version written in the file, read **without migrating it**.
 *
 * It goes through `openCache`, the one seam that knows which SQLite this runtime has — and
 * crucially `openCache` does **not** migrate: `migrate` runs inside `openStore`. So this reads the
 * number the file already carries rather than the number it would carry after being upgraded,
 * which is the whole point. A command asked to describe the state must not change it.
 */
const schemaVersionOf = async (file: string): Promise<number | undefined> => {
  try {
    const database = await openCache(file)
    try {
      const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined
      return typeof row?.user_version === "number" ? row.user_version : undefined
    } finally {
      database.close()
    }
  } catch {
    return undefined
  }
}
