import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Chat, Message } from "../domain/models.js"
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

  it("forgets everything when cleared", async () => {
    const store = await open()
    store.chats.write([chat("1", 100)])
    store.messages.write("5", [message("a", 100, "hello")])
    store.clear()

    expect(store.chats.read(60_000)).toBeUndefined()
    expect(store.messages.read("5", 20, 60_000)).toBeUndefined()
  })
})
