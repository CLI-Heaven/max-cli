import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { CacheDatabase } from "./driver.js"
import { openCache } from "./open.js"

const open = async () => {
  const database = await openCache(join(mkdtempSync(join(tmpdir(), "max-cache-")), "cache.db"))
  opened.push(database)
  return database
}

const opened: CacheDatabase[] = []
afterEach(() => {
  for (const database of opened.splice(0)) database.close()
})

const LEASE = `
  CREATE TABLE fetch_lease (
    chat_id    TEXT NOT NULL,
    anchor     TEXT NOT NULL,
    holder     TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, anchor)
  )`

const CLAIM = `
  INSERT INTO fetch_lease (chat_id, anchor, holder, expires_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id, anchor) DO UPDATE
    SET holder = excluded.holder, expires_at = excluded.expires_at
    WHERE fetch_lease.expires_at <= ?`

describe("the SQLite seam", () => {
  it("takes whatever this runtime has and speaks plain SQL through it", async () => {
    const database = await open()
    database.exec("CREATE TABLE t (a TEXT PRIMARY KEY, b INTEGER)")
    database.prepare("INSERT INTO t VALUES (?, ?)").run("x", 1)

    expect(database.prepare("SELECT b FROM t WHERE a = ?").get("x")).toEqual({ b: 1 })
    expect(database.prepare("SELECT * FROM t").all()).toHaveLength(1)
    expect(database.prepare("SELECT b FROM t WHERE a = ?").get("nothing")).toBeUndefined()
  })

  it("**is in write-ahead mode**, so a reader never waits for a writer", async () => {
    const database = await open()
    expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" })
  })

  it("reports how many rows a write changed, which is what the fetch lease rests on", async () => {
    const database = await open()
    database.exec(LEASE)
    const claim = database.prepare(CLAIM)
    const now = 1000

    expect(claim.run("5", "latest", "A", now + 30_000, now).changes, "A takes it").toBe(1)
    expect(claim.run("5", "latest", "B", now + 30_000, now).changes, "B is refused").toBe(0)
  })

  it("**leases a window, not a chat** — a second agent reading further back is not blocked", async () => {
    const database = await open()
    database.exec(LEASE)
    const claim = database.prepare(CLAIM)
    const now = 1000

    expect(claim.run("5", "latest", "A", now + 30_000, now).changes).toBe(1)
    expect(claim.run("5", "1781700000000", "B", now + 30_000, now).changes, "a different window").toBe(1)
  })

  it("**expires by itself**, because a holder that died never releases anything", async () => {
    const database = await open()
    database.exec(LEASE)
    const claim = database.prepare(CLAIM)
    const now = 1000

    claim.run("5", "latest", "A", now + 30_000, now)
    const afterExpiry = now + 30_001

    expect(claim.run("5", "latest", "B", afterExpiry + 30_000, afterExpiry).changes).toBe(1)
    expect(database.prepare("SELECT holder FROM fetch_lease WHERE chat_id = ?").get("5")).toEqual({ holder: "B" })
  })
})
