import { once } from "node:events"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { afterEach, describe, expect, it } from "vitest"
import type { Chat, Contact, Id, Message } from "../domain/models.js"
import { openCache } from "./open.js"
import { type CacheStore, openStore } from "./store.js"

const open = async (now: () => number = () => 1_000_000) => {
  const database = await openCache(join(mkdtempSync(join(tmpdir(), "max-store-")), "cache.db"))
  const store = openStore({ database, now })
  opened.push(store)
  return store
}

const opened: CacheStore[] = []
afterEach(() => {
  for (const store of opened.splice(0)) store.close()
})

const chat = (id: string, at: number): Chat => ({
  id,
  title: `chat ${id}`,
  kind: "dialog",
  unreadCount: 0,
  lastMessageAt: new Date(at).toISOString(),
  participantsCount: 2,
})

const person = (id: string, name: string | null = `person ${id}`): Contact => ({
  id,
  name,
  username: null,
  description: null,
  lastMessagedAt: null,
})

const delta = (over: Partial<Parameters<CacheStore["mergeDelta"]>[0]> = {}) => ({
  chats: [],
  people: [],
  members: new Map<Id, Id[]>(),
  marker: 1,
  ...over,
})

const group = (id: string, at: number): Chat => ({ ...chat(id, at), kind: "group", participantsCount: 3 })

const recent = { order: "recent" as const, limit: 20, offset: 0 }

const message = (id: string, at: number, text: string, editedAt: string | null = null): Message => ({
  id,
  chatId: "5",
  senderId: "7",
  senderName: "Someone",
  timestamp: new Date(at).toISOString(),
  editedAt,
  text,
  outgoing: false,
  attachments: [],
  replyTo: null,
  forwardedFrom: null,
  reactions: null,
})

describe("searching the store", () => {
  const named = (id: string, title: string): Chat => ({ ...chat(id, 100), title })

  it("**matches a Russian name whatever its case** — the measurement this index exists for", async () => {
    const store = await open()
    store.chats.write([named("1", "Иван Петров"), named("2", "Work Chat")])

    // `LIKE`, `lower()` and `COLLATE NOCASE` all miss this: they fold ASCII only.
    expect(store.chats.page({ limit: 20, offset: 0, query: "иван" }).map((c) => c.title)).toEqual(["Иван Петров"])
    expect(store.chats.page({ limit: 20, offset: 0, query: "ИВАН" }).map((c) => c.title)).toEqual(["Иван Петров"])
  })

  it("matches inside a word, which is what `unicode61` could not do", async () => {
    const store = await open()
    store.chats.write([named("1", "Иван Петров")])

    expect(store.chats.page({ limit: 20, offset: 0, query: "етро" }).map((c) => c.title)).toEqual(["Иван Петров"])
  })

  it("**survives a name that is FTS5 syntax**, instead of failing the command", async () => {
    const store = await open()
    store.chats.write([named("1", "O'Brien & Co"), named("2", "a-b test"), named("3", 'say "hello"')])

    // Unescaped, each of these is a syntax error rather than a search.
    expect(store.chats.page({ limit: 20, offset: 0, query: "O'Brien" }).map((c) => c.id)).toEqual(["1"])
    expect(store.chats.page({ limit: 20, offset: 0, query: "a-b" }).map((c) => c.id)).toEqual(["2"])
    expect(store.chats.page({ limit: 20, offset: 0, query: '"hello"' }).map((c) => c.id)).toEqual(["3"])
  })

  it("**counts what it pages**, or `hasMore` would lie on a filtered list", async () => {
    const store = await open()
    store.chats.write([named("1", "Иван Петров"), named("2", "Иван Сидоров"), named("3", "Work Chat")])

    expect(store.chats.count({ query: "иван" })).toBe(2)
    expect(store.chats.count({ kind: "dialog" })).toBe(3)
    expect(store.chats.count()).toBe(3)
  })

  it("**`--unread` pages and counts the same chats**, and a chat MAX said nothing about is not unread", async () => {
    const store = await open()
    store.chats.write([
      { ...named("1", "Unread"), unreadCount: 3 },
      { ...named("2", "Read"), unreadCount: 0 },
      { ...named("3", "Unknown"), unreadCount: null },
    ])

    expect(store.chats.page({ limit: 20, offset: 0, unread: true }).map((c) => c.id)).toEqual(["1"])
    expect(store.chats.count({ unread: true })).toBe(1)
  })

  it("**forgets a renamed chat's old name** — an external index does not follow its table alone", async () => {
    const store = await open()
    store.chats.write([named("1", "Work Chat")])
    store.chats.write([named("1", "Renamed")])

    expect(store.chats.page({ limit: 20, offset: 0, query: "Work" })).toEqual([])
    expect(store.chats.page({ limit: 20, offset: 0, query: "Rena" }).map((c) => c.id)).toEqual(["1"])
  })

  it("keeps a person findable when a later sighting omits their name", async () => {
    const store = await open()
    store.people.upsert([person("7", "Иван Петров")], "login")
    // A participant list carries an id and often nothing else; `putPerson` coalesces, so the
    // trigger has to index the row that results rather than the null that arrived.
    store.people.upsert([person("7", null)], "participant")

    store.mergeDelta(delta({ chats: [chat("5", 100)], members: new Map([["5", ["7"]]]) }))
    expect(store.people.contacts({ ...recent, query: "иван" }).map((p) => p.id)).toEqual(["7"])
  })

  it("finds a message by its text, across chats, newest first", async () => {
    const store = await open()
    store.chats.write([named("5", "Иван Петров")])
    store.messages.write("5", [message("a", 100, "договорились на ЧЕТВЕРГ"), message("b", 200, "ничего про это")])

    const found = store.messages.search({ query: "четве", limit: 20, offset: 0 })
    expect(found.map((m) => m.id)).toEqual(["a"])
    // The chat's name travels with the hit: a search spans chats, and an id alone makes the
    // reader look up their own results.
    expect(found[0]?.chatTitle).toBe("Иван Петров")
    expect(store.messages.countSearch({ query: "четве" })).toBe(1)
  })

  it("**forgets a deleted message** — neither read back nor found", async () => {
    const store = await open()
    store.messages.write("5", [message("a", 100, "удалю потом"), message("b", 200, "оставлю")])
    store.messages.forget("5", ["a"])

    expect(store.messages.search({ query: "удалю", limit: 20, offset: 0 })).toEqual([])
    expect(store.messages.window("5", 300, 10, 0).map((m) => m.id)).toEqual(["b"])
  })

  it("**stops finding a message whose text was edited away**", async () => {
    const store = await open()
    store.messages.write("5", [message("a", 100, "the original text")])
    store.messages.write("5", [message("a", 100, "something else entirely")])

    expect(store.messages.search({ query: "original", limit: 20, offset: 0 })).toEqual([])
    expect(store.messages.search({ query: "entirely", limit: 20, offset: 0 }).map((m) => m.id)).toEqual(["a"])
  })

  it("narrows a search to one chat when asked", async () => {
    const store = await open()
    store.messages.write("5", [message("a", 100, "shared word here")])
    store.messages.write("6", [{ ...message("b", 200, "shared word too"), chatId: "6" }])

    expect(store.messages.search({ query: "shared", limit: 20, offset: 0 })).toHaveLength(2)
    expect(store.messages.search({ query: "shared", chatId: "6", limit: 20, offset: 0 }).map((m) => m.id)).toEqual([
      "b",
    ])
  })
})

describe("the cache store", () => {
  it("gives back what it was given, newest chat first", async () => {
    const store = await open()
    store.chats.write([chat("1", 100), chat("2", 300)])

    expect((store.chats.read(60_000) ?? []).map((c) => c.id)).toEqual(["2", "1"])
  })

  it("**answers nothing when it was never told**, rather than answering emptily", async () => {
    const store = await open()
    expect(store.chats.read(60_000)).toBeUndefined()
    expect(store.messages.read("5", 20, 60_000)).toBeUndefined()
  })

  it("answers nothing once it is stale, which is what sends the command to MAX", async () => {
    let clock = 1_000_000
    const store = await open(() => clock)
    store.chats.write([chat("1", 100)])

    expect(store.chats.read(60_000)).toHaveLength(1)
    clock += 60_001
    expect(store.chats.read(60_000)).toBeUndefined()
  })

  it("returns messages oldest first, the way the command prints them", async () => {
    const store = await open()
    store.messages.write("5", [message("a", 100, "first"), message("b", 200, "second")])

    expect((store.messages.read("5", 20, 60_000) ?? []).map((m) => m.text)).toEqual(["first", "second"])
  })

  it("keeps what a reply answered and what a forward carried, so --offline shows them too", async () => {
    const store = await open()
    const quoted = {
      id: "q",
      senderId: "8",
      senderName: null,
      timestamp: null,
      text: "the question",
      attachments: [],
      outgoing: false,
    }
    store.messages.write("5", [{ ...message("a", 100, "the answer"), replyTo: quoted }, message("b", 200, "plain")])

    const [reply, plain] = store.messages.read("5", 20, 60_000) ?? []
    expect(reply?.replyTo).toEqual(quoted)
    expect(reply?.forwardedFrom).toBeNull()
    expect(plain?.replyTo).toBeNull()
  })

  it("answers a window around a moment: n up to and including it, n after it, oldest first", async () => {
    const store = await open()
    store.messages.write(
      "5",
      [100, 200, 300, 400, 500].map((at) => message(String(at), at, `m${at}`)),
    )

    expect(store.messages.window("5", 300, 2, 1).map((m) => m.text)).toEqual(["m200", "m300", "m400"])
    expect(store.messages.window("6", 300, 2, 1)).toEqual([])
  })

  it("**never lets a stale fetch undo an edit**, whichever of the two writes last", async () => {
    const store = await open()
    const edited = new Date(500).toISOString()

    store.messages.write("5", [message("a", 100, "the edited text", edited)])
    // An agent that read the chat before the edit, finishing after the one that read it after.
    store.messages.write("5", [message("a", 100, "the original text", null)])

    expect((store.messages.read("5", 20, 60_000) ?? [])[0]?.text).toBe("the edited text")
  })

  it("takes an edit that arrives later", async () => {
    const store = await open()
    store.messages.write("5", [message("a", 100, "the original text", null)])
    store.messages.write("5", [message("a", 100, "the edited text", new Date(500).toISOString())])

    const stored = (store.messages.read("5", 20, 60_000) ?? [])[0]
    expect(stored?.text).toBe("the edited text")
    expect(stored?.editedAt).toBe(new Date(500).toISOString())
  })

  it("forgets a chat's messages after a send, because what it holds is now short one", async () => {
    const store = await open()
    store.messages.write("5", [message("a", 100, "hello")])
    store.messages.invalidate("5")

    expect(store.messages.read("5", 20, 60_000)).toBeUndefined()
  })

  describe("the fetch lease", () => {
    it("is won by one and refused to the other", async () => {
      const store = await open()
      expect(store.claim("5", "latest", "A", 30_000)).toBe(true)
      expect(store.claim("5", "latest", "B", 30_000)).toBe(false)
    })

    it("**covers a window, not a chat**, so reading further back is never blocked", async () => {
      const store = await open()
      store.claim("5", "latest", "A", 30_000)

      expect(store.claim("5", "1781700000000", "B", 30_000)).toBe(true)
    })

    it("is free again once released, and once expired", async () => {
      let clock = 1_000_000
      const store = await open(() => clock)

      store.claim("5", "latest", "A", 30_000)
      store.release("5", "latest")
      expect(store.claim("5", "latest", "B", 30_000)).toBe(true)

      clock += 30_001
      expect(store.claim("5", "latest", "C", 30_000)).toBe(true)
    })
  })

  describe("people, and which of them are contacts", () => {
    it("**a group member is a person and not a contact**, which is the whole shape of the schema", async () => {
      const store = await open()
      store.mergeDelta(
        delta({
          chats: [chat("1", 100), group("2", 200)],
          people: [person("alice"), person("bob"), person("carol")],
          members: new Map([
            ["1", ["alice"]],
            ["2", ["bob", "carol"]],
          ]),
        }),
      )

      expect(store.people.contacts(recent).map((p) => p.id)).toEqual(["alice"])
      expect(
        store.people
          .page(recent)
          .map((p) => p.id)
          .sort(),
      ).toEqual(["alice", "bob", "carol"])
    })

    it("orders contacts by when they last wrote, and the never-messaged last", async () => {
      const store = await open()
      store.mergeDelta(
        delta({
          chats: [chat("1", 100), chat("2", 300), { ...chat("3", 0), lastMessageAt: null }],
          people: [person("older"), person("newer"), person("silent")],
          members: new Map([
            ["1", ["older"]],
            ["2", ["newer"]],
            ["3", ["silent"]],
          ]),
        }),
      )

      expect(store.people.contacts(recent).map((p) => p.id)).toEqual(["newer", "older", "silent"])
      expect(store.people.contacts({ ...recent, order: "name" }).map((p) => p.id)).toEqual(["newer", "older", "silent"])
    })

    it("pages in SQL, and counts what a page is a page of", async () => {
      const store = await open()
      store.mergeDelta(
        delta({
          chats: [chat("1", 100), chat("2", 200), chat("3", 300)],
          people: [person("a"), person("b"), person("c")],
          members: new Map([
            ["1", ["a"]],
            ["2", ["b"]],
            ["3", ["c"]],
          ]),
        }),
      )

      expect(store.people.contacts({ order: "recent", limit: 2, offset: 0 }).map((p) => p.id)).toEqual(["c", "b"])
      expect(store.people.contacts({ order: "recent", limit: 2, offset: 2 }).map((p) => p.id)).toEqual(["a"])
      expect(store.people.countContacts()).toBe(3)
    })

    it("answers which chats a person shares with us, which is why membership is stored", async () => {
      const store = await open()
      store.mergeDelta(
        delta({
          chats: [group("1", 100), group("2", 200)],
          people: [person("alice")],
          members: new Map([
            ["1", ["alice"]],
            ["2", ["alice"]],
          ]),
        }),
      )

      expect(store.people.chatsWith("alice").sort()).toEqual(["1", "2"])
    })

    it("gives a chat card its members and a person card their chats, from the same membership", async () => {
      const store = await open()
      store.mergeDelta(
        delta({
          chats: [group("1", 100), group("2", 200)],
          people: [person("alice", "Alice"), person("bob", "Bob")],
          members: new Map([
            ["1", ["alice", "bob"]],
            ["2", ["alice"]],
          ]),
        }),
      )

      expect(store.chats.members("1").map((m) => m.name)).toEqual(["Alice", "Bob"])
      expect(store.people.sharedChats("alice").map((c) => c.id)).toEqual(["2", "1"])
      expect(store.people.get("bob")?.name).toBe("Bob")
      expect(store.people.get("nobody")).toBeUndefined()
      expect(store.chats.get("2")?.kind).toBe("group")
    })

    it("**orders somebody whose name arrived after their chat did**", async () => {
      const store = await open()

      // The login carries the chat and who is in it, but not who that person is: it names six
      // people out of twenty-two on the real account.
      store.mergeDelta(delta({ chats: [chat("1", 300)], members: new Map([["1", ["late"]]]) }))
      expect(store.people.page(recent)).toEqual([])

      // The name comes back from a request sent afterwards. Nothing set a recency at merge time,
      // because there was no row to set it on.
      store.people.upsert([person("late")], "info")
      store.people.refreshRecency()

      expect(store.people.contacts(recent)[0]?.lastMessagedAt).toBe(new Date(300).toISOString())
    })

    it("leaves somebody met only in a group with no recency at all", async () => {
      const store = await open()
      store.mergeDelta(delta({ chats: [group("1", 300)], members: new Map([["1", ["member"]]]) }))
      store.people.upsert([person("member")], "participant")
      store.people.refreshRecency()

      expect(store.people.page(recent)[0]?.lastMessagedAt).toBeNull()
      expect(store.people.contacts(recent)).toEqual([])
    })

    it("**never blanks a name it already had** when a later source omits it", async () => {
      const store = await open()
      store.people.upsert([person("alice", "Alice")], "info")
      store.people.upsert([person("alice", null)], "participant")

      expect(store.people.page(recent)[0]?.name).toBe("Alice")
    })
  })

  describe("the delta sync", () => {
    it("**merges rather than replaces**, because after the first login absence means unchanged", async () => {
      const store = await open()
      store.mergeDelta(
        delta({ chats: [chat("1", 100)], people: [person("alice")], members: new Map([["1", ["alice"]]]) }),
      )
      store.mergeDelta(delta({ people: [person("bob")], marker: 2 }))

      expect(
        store.people
          .page(recent)
          .map((p) => p.id)
          .sort(),
      ).toEqual(["alice", "bob"])
      expect(store.people.contacts(recent).map((p) => p.id)).toEqual(["alice"])
    })

    it("keeps the members of a chat the delta did not mention", async () => {
      const store = await open()
      store.mergeDelta(
        delta({ chats: [group("1", 100)], people: [person("alice")], members: new Map([["1", ["alice"]]]) }),
      )
      store.mergeDelta(delta({ chats: [group("2", 200)], members: new Map([["2", []]]), marker: 2 }))

      expect(store.people.chatsWith("alice")).toEqual(["1"])
    })

    it("**drops a member who left, and keeps the person**", async () => {
      const store = await open()
      store.mergeDelta(
        delta({
          chats: [group("1", 100)],
          people: [person("alice"), person("bob")],
          members: new Map([["1", ["alice", "bob"]]]),
        }),
      )
      store.mergeDelta(delta({ chats: [group("1", 100)], members: new Map([["1", ["alice"]]]), marker: 2 }))

      expect(store.people.chatsWith("bob")).toEqual([])
      expect(
        store.people
          .page(recent)
          .map((p) => p.id)
          .sort(),
      ).toEqual(["alice", "bob"])
    })

    it("remembers the marker, and forgets it when asked", async () => {
      const store = await open()
      expect(store.syncMarker()).toBeUndefined()

      store.mergeDelta(delta({ marker: 1_781_700_000_000 }))
      expect(store.syncMarker()).toBe(1_781_700_000_000)

      store.forgetSyncMarker()
      expect(store.syncMarker()).toBeUndefined()
    })

    it("**leaves the marker alone when the write fails**, so the next login asks again", async () => {
      const store = await open()
      store.mergeDelta(delta({ marker: 1 }))

      // A person id of the wrong type is refused by SQLite mid-transaction; anything that throws
      // inside the merge does. What matters is that the marker does not move on ahead of the rows.
      expect(() =>
        store.mergeDelta(
          delta({ people: [person("alice")], members: new Map([["1", [{} as unknown as Id]]]), marker: 2 }),
        ),
      ).toThrow()

      expect(store.syncMarker()).toBe(1)
      expect(store.people.page(recent)).toEqual([])
    })

    it("**waits for another command's write** instead of losing the merge", async () => {
      const path = join(mkdtempSync(join(tmpdir(), "max-store-")), "cache.db")
      const store = openStore({ database: await openCache(path), now: () => 1_000_000 })
      opened.push(store)

      // node:sqlite is synchronous, so the other writer needs its own thread to commit while
      // mergeDelta is blocked. It holds the write lock across the merge's first read.
      const other = new Worker(
        `
        const { parentPort, workerData } = require("node:worker_threads")
        const { DatabaseSync } = require("node:sqlite")
        const database = new DatabaseSync(workerData.path)
        database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE")
        database.exec("INSERT INTO people (id, source, fetched_at) VALUES ('bob', 'login', 1)")
        parentPort.postMessage("locked")
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
        database.exec("COMMIT")
        database.close()
        `,
        { eval: true, workerData: { path } },
      )
      const finished = once(other, "exit")
      await once(other, "message")

      store.mergeDelta(delta({ people: [person("alice")], marker: 2 }))
      await finished

      expect(store.syncMarker()).toBe(2)
      expect(
        store.people
          .page(recent)
          .map((p) => p.id)
          .sort(),
      ).toEqual(["alice", "bob"])
    })
  })

  it("forgets everything when cleared", async () => {
    const store = await open()
    store.chats.write([chat("1", 100)])
    store.messages.write("5", [message("a", 100, "hello")])
    store.clear()

    expect(store.chats.read(60_000)).toBeUndefined()
    expect(store.messages.read("5", 20, 60_000)).toBeUndefined()
  })

  it("forgets the sync marker when cleared, or the next login asks for a delta over nothing", async () => {
    const store = await open()
    store.mergeDelta(delta({ chats: [chat("1", 100)], people: [person("alice")], marker: 7 }))
    store.clear()

    expect(store.syncMarker()).toBeUndefined()
    expect(store.people.page(recent)).toEqual([])
  })
})
