import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openCache } from "./open.js"
import { migrate, SCHEMA_VERSION } from "./schema.js"
import { openStore } from "./store.js"

const file = () => join(mkdtempSync(join(tmpdir(), "max-schema-")), "cache.db")

/** Schema 1, as it was shipped: a `contacts` table, and no `people` or memberships. */
const asVersion1 = async (path: string) => {
  const database = await openCache(path)
  database.exec(`CREATE TABLE contacts (
     id TEXT PRIMARY KEY, name TEXT, username TEXT, description TEXT, fetched_at INTEGER NOT NULL)`)
  database.exec(`CREATE TABLE fetched (kind TEXT PRIMARY KEY, at INTEGER NOT NULL)`)
  database.exec("INSERT INTO contacts VALUES ('alice', 'Alice', NULL, NULL, 1)")
  database.exec("INSERT INTO fetched VALUES ('contacts', 1)")
  database.exec("PRAGMA user_version = 1")
  return database
}

describe("the schema", () => {
  it("**rebuilds a file from the previous version rather than half-reading it**", async () => {
    const path = file()
    ;(await asVersion1(path)).close()

    const database = await openCache(path)
    const store = openStore({ database })

    expect(store.people.page({ order: "name", limit: 20, offset: 0 })).toEqual([])
    expect(store.syncMarker()).toBeUndefined()
    store.close()
  })

  it("says so when the sweep is gone, rather than leaving a short list looking like an answer", async () => {
    const path = file()
    ;(await asVersion1(path)).close()

    const database = await openCache(path)
    const store = openStore({ database })

    // The old `fetched` row claimed the contacts were complete. Surviving the rebuild, it would
    // have made `--offline` answer emptily instead of admitting it holds nothing.
    expect(store.contacts.read(Number.POSITIVE_INFINITY)).toBeUndefined()
    store.close()
  })

  it("**refuses a file from the future** instead of writing to it", async () => {
    const path = file()
    const database = await openCache(path)
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)

    expect(() => migrate(database)).toThrow(/newer max/)
    database.close()
  })

  it("leaves a current file alone, rows and all", async () => {
    const path = file()
    const first = await openCache(path)
    const store = openStore({ database: first })
    store.people.upsert(
      [{ id: "alice", name: "Alice", username: null, description: null, lastMessagedAt: null }],
      "login",
    )
    store.close()

    const second = await openCache(path)
    const reopened = openStore({ database: second })

    expect(reopened.people.page({ order: "name", limit: 20, offset: 0 }).map((p) => p.id)).toEqual(["alice"])
    reopened.close()
  })
})
