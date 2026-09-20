import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
