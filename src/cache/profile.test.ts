import { chmodSync, existsSync, mkdtempSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openProfileCache } from "./index.js"
import { openCache } from "./open.js"

/** A directory that does not exist yet — which is every machine, the first time. */
const freshHome = () => {
  const root = mkdtempSync(join(tmpdir(), "max-fresh-"))
  return { MAX_CACHE_DIR: join(root, "never", "created", "before"), MAX_CONFIG_DIR: root, MAX_STATE_DIR: root }
}

describe("opening a profile's record", () => {
  it("**creates its directory**, because SQLite will not and no machine has one to begin with", async () => {
    const env = freshHome()
    const store = await openProfileCache("default", { env })

    expect(store, "the record must open on a machine that has never run this").toBeDefined()
    expect(existsSync(join(env.MAX_CACHE_DIR, "default.db"))).toBe(true)
    store?.close()
  })

  it("keeps the file to itself, since it holds message text", async () => {
    const env = freshHome()
    const store = await openProfileCache("default", { env })
    const file = join(env.MAX_CACHE_DIR, "default.db")

    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(`${file}-wal`).mode & 0o777).toBe(0o600)
    expect(statSync(`${file}-shm`).mode & 0o777).toBe(0o600)
    expect(statSync(env.MAX_CACHE_DIR).mode & 0o777).toBe(0o700)
    store?.close()
  })

  it("puts right a directory and files an older version left open to others", async () => {
    const env = freshHome()
    const file = join(env.MAX_CACHE_DIR, "default.db")
    ;(await openProfileCache("default", { env }))?.close()
    chmodSync(env.MAX_CACHE_DIR, 0o755)
    chmodSync(file, 0o644)

    const store = await openProfileCache("default", { env })

    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(env.MAX_CACHE_DIR).mode & 0o777).toBe(0o700)
    store?.close()
  })

  it("**says so when it cannot open**, rather than being off in silence", async () => {
    const problems: string[] = []
    // A path under a file rather than a directory: it cannot be created, whatever the permissions.
    const notADirectory = join(mkdtempSync(join(tmpdir(), "max-fresh-")), "a-file")
    const { writeFileSync } = await import("node:fs")
    writeFileSync(notADirectory, "")

    const store = await openProfileCache("default", {
      env: { MAX_CACHE_DIR: join(notADirectory, "cache") },
      onProblem: (message) => problems.push(message),
    })

    expect(store).toBeUndefined()
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("ran against MAX")
  })

  it("names the schema when a newer max wrote the file, instead of a bare `Error`", async () => {
    const env = { MAX_CACHE_DIR: mkdtempSync(join(tmpdir(), "max-newer-")) }
    const database = await openCache(join(env.MAX_CACHE_DIR, "default.db"))
    database.exec("PRAGMA user_version = 99")
    database.close()

    const problems: string[] = []
    const store = await openProfileCache("default", { env, onProblem: (message) => problems.push(message) })

    expect(store).toBeUndefined()
    expect(problems[0]).toContain("schema 99")
    expect(problems[0]).not.toContain(env.MAX_CACHE_DIR)
  })
})
