import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathsAreOverridden, resolvePaths } from "@leemour/cli-core"
import { openCache } from "./cache/open.js"
import { SCHEMA_VERSION } from "./cache/schema.js"
import { checkInstall, type Install, ownScript } from "./install.js"
import { runtime } from "./runs/run.js"
import { CLIENT } from "./spec/identity.js"
import { isInstalled, modelsDirectory } from "./transcribe/install.js"
import { DEFAULT_MODEL, findModel } from "./transcribe/models.js"

export interface DiagnoseOptions {
  profile: string
  env?: NodeJS.ProcessEnv
  /** Tests point these at a temporary directory; nothing else should need them. */
  stateDir?: string
  cacheDir?: string
  /** Injected so a test needs no SQLite file and no keyring. */
  readSchemaVersion?: (file: string) => Promise<number | undefined>
  /** Where a stored token is — the keyring, or the file that stands in for one; `undefined` for none. */
  storedToken?: (profile: string) => "keyring" | "file" | undefined
  now?: () => Date
  install?: () => Install
  native?: () => Promise<Native>
  /** The configured speech model's id, and where models are kept. */
  speechModel?: string
  modelsDir?: string
}

/** `"ok"`, or why that part cannot load — the message names the missing platform build. */
export interface Native {
  keyring: string
  sqlite: string
}

export type TokenSource = "environment" | "keyring" | "file" | "none"

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
    /** MAX refused a login for too many attempts; none goes out before this (`MAX-38`). */
    loginPausedUntil: string | null
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
  /** The web client we present, and how old that reading is. Past `STALE_AFTER_DAYS` MAX may refuse it. */
  client: { appVersion: string; chrome: string; readOn: string; ageDays: number; stale: boolean }
  install: Install
  native: Native
  speech: { model: string; languages: string | null; downloaded: boolean }
}

/** Owner's ruling, NEED-264: the web client releases more often than that, and breaks later. */
export const STALE_AFTER_DAYS = 60

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
  storedToken = () => undefined,
  now = () => new Date(),
  install = () => thisInstall(env),
  native = loadNative,
  speechModel = DEFAULT_MODEL,
  modelsDir,
}: DiagnoseOptions): Promise<Diagnosis> => {
  const paths = resolvePaths({ appName: "max-cli", prefix: "MAX", env })
  const state = stateDir ?? paths.state
  const cacheHome = cacheDir ?? paths.cache

  const moved = pathsAreOverridden({ appName: "max-cli", prefix: "MAX", env })
  const fromEnvironment = (env.MAX_TOKEN ?? "").trim() !== ""
  const tokenAt = fromEnvironment ? undefined : storedToken(profile)

  const stateFile = join(state, "profiles", `${profile}.json`)
  const stored = readState(stateFile)

  const cacheFile = join(cacheHome, `${profile}.db`)
  const cacheExists = existsSync(cacheFile)
  const schemaVersion = cacheExists ? await readSchemaVersion(cacheFile) : undefined

  const runsDirectory = join(state, "runs")

  return {
    token: {
      present: fromEnvironment || tokenAt !== undefined,
      from: fromEnvironment ? "environment" : (tokenAt ?? "none"),
    },
    keyring: { service: moved ? `max-cli:${paths.config}` : "max-cli", movedByEnvironment: moved },
    session: {
      stateFile,
      exists: stored !== undefined,
      deviceId: typeof stored?.deviceId === "string" && stored.deviceId !== "",
      viewerId: typeof stored?.viewerId === "string" && stored.viewerId !== "",
      logins: typeof stored?.logins === "number" ? stored.logins : null,
      lastLoginAt: typeof stored?.lastLoginAt === "string" ? stored.lastLoginAt : null,
      loginPausedUntil:
        typeof stored?.loginPausedUntil === "string" && Date.parse(stored.loginPausedUntil) > Date.now()
          ? stored.loginPausedUntil
          : null,
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
    client: clientAge(now()),
    install: install(),
    native: await native(),
    speech: speechOf(speechModel, modelsDir ?? modelsDirectory(env)),
  }
}

const speechOf = (id: string, directory: string) => {
  const model = findModel(id)
  return { model: id, languages: model?.languages ?? null, downloaded: model ? isInstalled(model, directory) : false }
}

const thisInstall = (env: NodeJS.ProcessEnv): Install =>
  checkInstall({
    scriptPath: ownScript(),
    execPath: process.execPath,
    runtime: runtime(),
    env,
    platform: process.platform,
  })

/** The two parts that are not JavaScript. Loaded here, never used: a load that fails is the answer. */
const loadNative = async (): Promise<Native> => {
  const attempt = async (load: () => unknown): Promise<string> => {
    try {
      await load()
      return "ok"
    } catch (error) {
      return error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error)
    }
  }
  return {
    // The keyring module belongs to cli-core, so it is resolved from there, as cli-core does.
    keyring: await attempt(() => createRequire(import.meta.resolve("@leemour/cli-core"))("@napi-rs/keyring")),
    sqlite: await attempt(async () => (await openCache(":memory:")).close()),
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

const DAY_MS = 86_400_000

const clientAge = (today: Date) => {
  const ageDays = Math.floor((today.getTime() - Date.parse(CLIENT.readOn)) / DAY_MS)
  return { ...CLIENT, ageDays, stale: ageDays > STALE_AFTER_DAYS }
}
