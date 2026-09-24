import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Message } from "../domain/models.js"
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

const message = (id: string, at: number, text: string): Message => ({
  id,
  chatId: "5",
  senderId: "7",
  senderName: "Someone",
  timestamp: new Date(at).toISOString(),
  editedAt: null,
  text,
  outgoing: false,
  attachments: [],
  replyTo: null,
  forwardedFrom: null,
  reactions: null,
})

const search = (store: ReturnType<typeof openStore>, query: string) =>
  store.messages.search({ query, limit: 20, offset: 0 }).map((hit) => hit.id)

/** A file this version wrote, then marked one version older — every trigger, index and FTS table in place. */
const previousVersionWith = async (path: string, messages: Message[]) => {
  const store = openStore({ database: await openCache(path) })
  store.people.upsert(
    [{ id: "alice", name: "Alice", username: null, description: null, lastMessagedAt: null }],
    "login",
  )
  store.messages.write("5", messages)
  store.close()

  const database = await openCache(path)
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 1}`)
  database.close()
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

  it("takes the old sweep record with it, rather than claiming rows it has just dropped", async () => {
    const path = file()
    ;(await asVersion1(path)).close()

    const database = await openCache(path)
    const store = openStore({ database })

    // The v1 `fetched` row said the contacts were complete. Surviving the rebuild, it would claim
    // a sweep whose rows are gone — which is a lie the offline path would believe.
    expect(store.chats.read(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(store.people.count()).toBe(0)
    store.close()
  })

  it("**keeps the history through an upgrade**, and search still finds it", async () => {
    const path = file()
    await previousVersionWith(path, [message("a", 100, "договорились на четверг"), message("b", 200, "ok")])

    const store = openStore({ database: await openCache(path) })

    expect(store.messages.window("5", 200, 5, 0).map((m) => m.id)).toEqual(["a", "b"])
    expect(search(store, "четверг")).toEqual(["a"])
    expect(store.people.count()).toBe(0)
    store.close()
  })

  it("indexes what is written after the upgrade, so the triggers came back too", async () => {
    const path = file()
    await previousVersionWith(path, [message("a", 100, "old words")])

    const store = openStore({ database: await openCache(path) })
    store.messages.write("5", [message("c", 300, "fresh words")])
    store.messages.write("5", [message("a", 100, "edited words")])

    expect(search(store, "fresh")).toEqual(["c"])
    expect(search(store, "old")).toEqual([])
    expect(search(store, "edited")).toEqual(["a"])
    store.close()
  })

  it("carries messages over from schema 1, whose table had no `link` column", async () => {
    const path = file()
    const database = await asVersion1(path)
    database.exec(`CREATE TABLE messages (
       chat_id TEXT NOT NULL, id TEXT NOT NULL, sender_id TEXT, sender_name TEXT, time INTEGER NOT NULL,
       update_time INTEGER, text TEXT NOT NULL, outgoing INTEGER, attachments TEXT NOT NULL,
       fetched_at INTEGER NOT NULL, PRIMARY KEY (chat_id, id))`)
    database.exec(`CREATE TABLE ranges (
       chat_id TEXT NOT NULL, from_time INTEGER NOT NULL, to_time INTEGER NOT NULL, PRIMARY KEY (chat_id, from_time))`)
    database.exec("INSERT INTO messages VALUES ('5', 'a', '7', 'Someone', 100, NULL, 'hello there', 0, '[]', 1)")
    database.exec("INSERT INTO ranges VALUES ('5', 100, 100)")
    database.close()

    const store = openStore({ database: await openCache(path) })

    expect(store.messages.window("5", 100, 1, 0).map((m) => m.text)).toEqual(["hello there"])
    expect(search(store, "hello")).toEqual(["a"])
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
