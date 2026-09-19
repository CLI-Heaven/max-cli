import { type CacheDatabase, PRAGMAS } from "./driver.js"

/**
 * Opens the cache with whichever SQLite the runtime actually has.
 *
 * **Both imports are dynamic, and that is the whole point.** A static `import` of
 * `node:sqlite` fails under Bun at load time, and one of `bun:sqlite` fails under Node the same
 * way — before any code runs, so nothing can catch it and no test can reach it. Reaching the
 * import only inside the branch that can satisfy it is what makes one build serve both runtimes.
 *
 * Measured 2026-09-19: `node:sqlite` exists on Node 22.23.2 and 24 and not in Bun; `bun:sqlite`
 * is the reverse (`NEED-11`).
 */
export const openCache = async (path: string): Promise<CacheDatabase> => {
  const database = "Bun" in globalThis ? await openUnderBun(path) : await openUnderNode(path)
  database.exec(PRAGMAS)
  return database
}

const openUnderBun = async (path: string): Promise<CacheDatabase> => {
  const { openWithBunSqlite } = await import("./drivers/bun-sqlite.js")
  return await openWithBunSqlite(path)
}

const openUnderNode = async (path: string): Promise<CacheDatabase> => {
  const { openWithNodeSqlite } = await import("./drivers/node-sqlite.js")
  return openWithNodeSqlite(path)
}
