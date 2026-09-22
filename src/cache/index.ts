import { chmodSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { resolvePaths } from "@leemour/cli-core"
import { openCache } from "./open.js"
import { NewerCacheError } from "./schema.js"
import { type CacheStore, openStore } from "./store.js"

export type { CacheStore } from "./store.js"

export interface ProfileCacheOptions {
  env?: NodeJS.ProcessEnv
  /**
   * Where a cache that could not be opened is reported.
   *
   * ⚠ **Silence here hid the feature being entirely off for a day.** The `catch` was deliberate —
   * a cache must never fail the command it was meant to help — but swallowing the reason meant the
   * directory never being created looked identical to everything working. Failing quietly is
   * right; failing *invisibly* is not.
   */
  onProblem?: (message: string) => void
}

/**
 * Opens this profile's record, **or gives up without failing the command**.
 *
 * The file holds message text, so the directory is `0700` and the database `0600`. It lives under
 * the cache directory rather than the state one: deleting it must lose nothing that was typed.
 */
export const openProfileCache = async (
  profile: string,
  { env = process.env, onProblem }: ProfileCacheOptions = {},
): Promise<CacheStore | undefined> => {
  const paths = resolvePaths({ appName: "max-cli", prefix: "MAX", env })
  const file = join(paths.cache, `${profile}.db`)

  try {
    // SQLite will not create a file in a directory that does not exist, and on a fresh machine
    // this one never does.
    mkdirSync(paths.cache, { recursive: true, mode: 0o700 })
    const store = openStore({ database: await openCache(file) })
    chmodSync(file, 0o600)
    return store
  } catch (error) {
    onProblem?.(`the local record is unavailable, so this ran against MAX: ${asReason(error)}`)
    return undefined
  }
}

/** The reason, never the path — a profile name and a home directory are nobody else's business. */
const asReason = (error: unknown): string => {
  if (error instanceof NewerCacheError) return error.message
  const code = (error as { code?: unknown })?.code
  return typeof code === "string" ? code : error instanceof Error ? error.name : "an unknown problem"
}
