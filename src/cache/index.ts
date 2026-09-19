import { join } from "node:path"
import { resolvePaths } from "@cli-heaven/cli-core"
import { openCache } from "./open.js"
import { type CacheStore, openStore } from "./store.js"

export type { CacheStore } from "./store.js"

/** How long an answer may be reused. Guesses, and configuration will correct them (`CLI-4`). */
export const FRESHNESS = {
  chats: 5 * 60_000,
  contacts: 5 * 60_000,
  messages: 60_000,
} as const

/**
 * Opens this profile's cache, **or gives up quietly**.
 *
 * A locked, corrupt or unopenable cache must never fail the command it was only meant to make
 * faster. The caller gets `undefined`, connects to MAX, and nothing else in the program has to
 * know a cache exists.
 */
export const openProfileCache = async (profile: string, env = process.env): Promise<CacheStore | undefined> => {
  try {
    const paths = resolvePaths({ appName: "max-cli", prefix: "MAX", env })
    return openStore({ database: await openCache(join(paths.cache, `${profile}.db`)) })
  } catch {
    return undefined
  }
}
