import { existsSync, statSync, writeFileSync } from "node:fs"
import { memoryKeyring } from "@leemour/cli-core"
import { afterEach, describe, expect, it } from "vitest"
import { MaxClient } from "../client.js"
import { Opcode } from "../generated/opcodes.generated.js"
import { Connection } from "../protocol/connection.js"
import { SessionStore } from "../session/store.js"
import { mockMax } from "../testing/mock-max.js"
import { MaxServer, type ServerEvent } from "./server.js"
import { ServerConnection, serverStatus, stopServer } from "./server-connection.js"
import { subscribe } from "./subscribe.js"

const ME = 10000001

const scripted = () =>
  mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: ME, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [{ id: 111, title: "First", type: "CHAT", lastEventTime: 1789776000000 }],
        contacts: [{ id: 10000002, names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
      },
      [Opcode.PING]: {},
      [Opcode.CHAT_HISTORY]: {
        messages: [{ id: 116762160362694583n, time: 1789776000000, sender: 10000002, text: "hi", attaches: [] }],
      },
      [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
      [Opcode.MSG_SEND]: { message: { id: 116762160362694599n, time: 1789776001000, sender: ME, text: "sent" } },
    },
  })

const running: MaxServer[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

const serve = async (
  profile: string,
  max = scripted(),
  extra: { pingEveryMs?: number; refreshEveryMs?: number; idleMs?: number; startedByCommand?: boolean } = {},
) => {
  const store = new SessionStore({ profile, keyring: memoryKeyring() })
  store.writeToken("a-token")
  const notes: string[] = []
  const server = new MaxServer({
    store,
    note: (line) => notes.push(line),
    connection: (hooks) => new Connection({ ...hooks, live: true, createSocket: max.createSocket, timeoutMs: 200 }),
    retryAfterMs: () => 0,
    ...extra,
  })
  running.push(server)
  await server.start()
  return { server, store, max, notes }
}

/** Collects what a `max watch` would print, until the test stops listening. */
const watching = (store: SessionStore) => {
  const events: ServerEvent[] = []
  const stop = new AbortController()
  const listening = subscribe(store.socketPath(), store.profile, (event) => events.push(event), stop.signal)
  return { events, stop: () => stop.abort(), listening }
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

describe("max serve", () => {
  it("logs in once and listens on a socket only its owner can open", async () => {
    const { store, max } = await serve("s-start")

    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(1)
    expect(statSync(store.socketPath()).mode & 0o777).toBe(0o600)
  })

  it("hands a new message to every watcher in the shape `messages list` prints, and acknowledges it", async () => {
    const { store, max } = await serve("s-message")
    const watch = watching(store)
    await settle()

    max.push(
      128,
      { chatId: 111, message: { id: 116762160362694583n, time: 1789776000000, sender: 10000002, text: "hi" } },
      5,
    )
    await settle()
    watch.stop()
    await watch.listening

    expect(watch.events[0]).toMatchObject({ event: "status", connected: true })
    expect(watch.events[1]).toMatchObject({
      event: "message",
      message: { id: "116762160362694583", chatId: "111", text: "hi", senderName: "Someone Else", chatTitle: "First" },
    })
    expect(max.answered).toContainEqual({
      opcode: 128,
      seq: 5,
      payload: { chatId: 111, messageId: 116762160362694583n },
    })
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
  })

  it("pings on its own interval", async () => {
    const { max } = await serve("s-ping", scripted(), { pingEveryMs: 10 })
    await settle(150)

    expect(max.sent.filter((call) => call.opcode === Opcode.PING).length).toBeGreaterThanOrEqual(2)
    expect(max.sent.find((call) => call.opcode === Opcode.PING)?.payload).toEqual({ interactive: false })
  })

  it("logs in again when MAX drops it, and tells the watchers both ways", async () => {
    const { store, max } = await serve("s-drop")
    const watch = watching(store)
    await settle()

    max.drop()
    await settle(60)
    watch.stop()
    await watch.listening

    expect(watch.events.map((event) => event.event === "status" && event.connected)).toEqual([true, false, true])
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(2)
  })

  it("refuses a second server for the same profile, but takes over a file a crashed one left", async () => {
    const { store } = await serve("s-twice")
    await expect(serve("s-twice")).rejects.toThrow("already running")
    await expect(serve("s-twice", scripted(), { startedByCommand: true })).rejects.toThrow("already running")

    const stale = new SessionStore({ profile: "s-stale", keyring: memoryKeyring() })
    writeFileSync(stale.socketPath(), "")
    const { server } = await serve("s-stale")
    expect(server.connected).toBe(true)
    expect(existsSync(store.socketPath())).toBe(true)
  })

  it("closes the socket to MAX when the login is refused, so the process can exit", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {} }, refuse: { [Opcode.LOGIN]: "login.token" } })

    await expect(serve("s-refused", max)).rejects.toThrow("login.token")
    expect(max.closed).toBe(true)
  })

  it("stops by itself after the idle time when nobody uses it", async () => {
    const { server, store } = await serve("s-idle", scripted(), { idleMs: 40 })

    await expect(server.done).resolves.toBeUndefined()
    expect(existsSync(store.socketPath())).toBe(false)
  })

  it("stays up while a watcher listens, however long it is idle", async () => {
    const { server, store } = await serve("s-idle-watched", scripted(), { idleMs: 40 })
    const watch = watching(store)
    await settle(120)

    expect(server.connected).toBe(true)
    watch.stop()
    await watch.listening
  })

  it("stops when asked, if a command started it", async () => {
    const { server, store } = await serve("s-asked", scripted(), { startedByCommand: true })

    expect(await stopServer(store.socketPath())).toBe("stopped")
    await expect(server.done).resolves.toBeUndefined()
  })

  it("keeps running when asked to stop, if it was started by hand", async () => {
    const { server, store } = await serve("s-by-hand")

    expect(await stopServer(store.socketPath())).toBe("refused")
    expect(server.connected).toBe(true)
  })

  it("started by hand, stops for `max serve --stop`, which forces it", async () => {
    const { server, store } = await serve("s-forced")

    expect(await stopServer(store.socketPath(), { force: true })).toBe("stopped")
    await expect(server.done).resolves.toBeUndefined()
  })

  it("says whether it was started by hand, and its process", async () => {
    const { store } = await serve("s-status")

    expect(await serverStatus(store.socketPath())).toMatchObject({ connected: true, byHand: true, pid: process.pid })
  })

  it("started by hand, takes over from one a command started", async () => {
    const { server: first } = await serve("s-take-over", scripted(), { startedByCommand: true })
    const { server: second } = await serve("s-take-over")

    await expect(first.done).resolves.toBeUndefined()
    expect(second.connected).toBe(true)
  })

  it("removes its socket when it stops, and says it stopped", async () => {
    const { server, store } = await serve("s-stop")
    await server.stop()

    await expect(server.done).resolves.toBeUndefined()
    expect(existsSync(store.socketPath())).toBe(false)
  })

  it("`max watch` without a server names the command that starts one", async () => {
    const store = new SessionStore({ profile: "work", keyring: memoryKeyring() })
    await expect(subscribe(store.socketPath(), "work", () => {})).rejects.toThrow("max work serve")
  })
})

describe("a command through max serve", () => {
  /** MAX as a command's own connection would meet it — only used when it falls back or writes. */
  const own = () =>
    mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: {
          profile: { contact: { id: ME, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
          chats: [{ id: 111, title: "First", type: "CHAT", lastEventTime: 1789776000000 }],
        },
        [Opcode.MSG_SEND]: { message: { id: 116762160362694599n, time: 1789776001000, sender: ME, text: "sent" } },
      },
    })

  const commandClient = (store: SessionStore, direct = own()) => {
    let opened = 0
    const client = new MaxClient({
      store,
      connection: new ServerConnection({
        path: store.socketPath(),
        store,
        timeoutMs: 200,
        direct: () => {
          opened += 1
          return new Connection({ createSocket: direct.createSocket, timeoutMs: 200 })
        },
      }),
    })
    return { client, direct, opened: () => opened }
  }

  it("reads without logging in: the server's login answers, and the history goes over its connection", async () => {
    const { store, max } = await serve("c-read")
    const { client, opened } = commandClient(store)

    const chats = await client.chats.list()
    const page = await client.messages.list("111", { limit: 1 })
    await client.close()

    expect(chats.items.map((chat) => chat.id)).toEqual(["111"])
    expect(page.items[0]?.text).toBe("hi")
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(1)
    expect(max.sent.map((call) => call.opcode)).toContain(Opcode.CHAT_HISTORY)
    expect(opened()).toBe(0)
  })

  it("sends through the server too: one connection to MAX for everything", async () => {
    const { store, max } = await serve("c-send")
    const { client, opened } = commandClient(store)

    const sent = await client.messages.send("111", "sent")
    await client.close()

    expect(sent.id).toBe("116762160362694599")
    expect(opened()).toBe(0)
    expect(max.sent.filter((call) => call.opcode === Opcode.MSG_SEND)).toHaveLength(1)
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(1)
  })

  it("starts a server when none answers and uses it, rather than a connection of its own", async () => {
    const store = new SessionStore({ profile: "c-ensure", keyring: memoryKeyring() })
    store.writeToken("a-token")
    let started = 0
    const client = new MaxClient({
      store,
      connection: new ServerConnection({
        path: store.socketPath(),
        store,
        timeoutMs: 200,
        direct: () => {
          throw new Error("a connection of its own was opened")
        },
        ensure: async () => {
          started += 1
          await serve("c-ensure")
          return true
        },
      }),
    })

    await client.chats.list()
    await client.close()

    expect(started).toBe(1)
  })

  it("with no server running, the whole command uses its own connection", async () => {
    const store = new SessionStore({ profile: "c-none", keyring: memoryKeyring() })
    store.writeToken("a-token")
    const { client, direct } = commandClient(store)

    await client.chats.list()
    await client.close()

    expect(direct.sent.map((call) => call.opcode)).toEqual([Opcode.SESSION_INIT, Opcode.LOGIN])
  })

  it("still hands out a login a deletion made stale, rather than send the command to log in itself", async () => {
    const { store, max } = await serve("c-stale")
    max.push(142, { chatId: 111, messageIds: [1] }, 9)
    await settle()
    const { client, opened } = commandClient(store)

    await client.chats.list()
    await client.close()

    expect(opened()).toBe(0)
  })

  it("logs in again in the background once its login went stale, and hands that one out", async () => {
    const { store, max } = await serve("c-refresh", scripted(), { refreshEveryMs: 0 })
    max.push(142, { chatId: 111, messageIds: [1] }, 9)
    await settle(60)
    const { client, opened } = commandClient(store)

    await client.chats.list()
    await client.close()

    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(2)
    expect(opened()).toBe(0)
  })

  it("follows a chat read on another device: the unread count becomes what MAX says", async () => {
    const { store, max } = await serve("c-read-elsewhere")
    max.push(
      128,
      { chatId: 111, message: { id: 116762160362694590n, time: 1789776500000, sender: 10000002, text: "new" } },
      3,
    )
    max.push(130, { chatId: 111, userId: ME, mark: 1789776500000, unread: 0 }, 4)
    await settle()
    const { client, opened } = commandClient(store)

    const [chat] = (await client.chats.list()).items
    await client.close()

    expect(chat).toMatchObject({ id: "111", unreadCount: 0 })
    expect(opened()).toBe(0)
  })

  it("keeps its login current from a new message: the chat's unread count goes up", async () => {
    const { store, max } = await serve("c-patch")
    max.push(
      128,
      { chatId: 111, message: { id: 116762160362694590n, time: 1789776500000, sender: 10000002, text: "new" } },
      3,
    )
    await settle()
    const { client } = commandClient(store)

    const [chat] = (await client.chats.list()).items
    await client.close()

    expect(chat).toMatchObject({ id: "111", unreadCount: 1 })
    expect(Date.parse(chat?.lastMessageAt ?? "")).toBe(1789776500000)
  })

  it("does not pass on a login, whoever asks the socket directly", async () => {
    const { store, max } = await serve("c-raw")
    const socket = await import("node:net").then(({ connect }) => connect(store.socketPath()))
    const answer = await new Promise<string>((resolve) => {
      socket.once("data", (data) => resolve(String(data)))
      socket.write(`${JSON.stringify({ id: 1, opcode: Opcode.LOGIN, payload: { token: "x" } })}\n`)
    })
    socket.destroy()

    expect(answer).toContain("not_allowed")
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(1)
  })

  it("a token being tried out goes to MAX itself, not to the server's login", async () => {
    const { store } = await serve("c-token")
    const { client, direct } = commandClient(store)

    await client.connect({ token: "a-new-token" })
    await client.close()

    expect(direct.sent.map((call) => call.opcode)).toEqual([Opcode.SESSION_INIT, Opcode.LOGIN])
    expect(direct.sent[1]?.payload).toMatchObject({ token: "a-new-token" })
  })
})

describe("starting a server in the background", () => {
  it("does not try again for a while after MAX refused the login", async () => {
    const { refusedPath, startInBackground } = await import("./start.js")
    const store = new SessionStore({ profile: "b-refused", keyring: memoryKeyring() })
    store.writeToken("a-token")
    writeFileSync(refusedPath(store), "")

    expect(startInBackground(store, { entry: "/nonexistent/max.js" })).toBeUndefined()
    expect(existsSync(`${store.socketPath()}.starting`)).toBe(false)
  })
})
