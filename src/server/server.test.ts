import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:net"
import { dirname } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { decode, ExtData } from "@msgpack/msgpack"
import { afterEach, describe, expect, it } from "vitest"
import { MaxClient } from "../client.js"
import { contextFor } from "../commands/context.js"
import { Opcode } from "../generated/opcodes.generated.js"
import { run } from "../program.js"
import { Connection } from "../protocol/connection.js"
import { decodeHeader, HEADER_BYTES } from "../protocol/frame.js"
import { decompressBlock } from "../protocol/lz4.js"
import { SendJournal, sendsPathFor } from "../sends/journal.js"
import { RecipientList, recipientsPathFor } from "../sends/recipients.js"
import { SessionStore } from "../session/store.js"
import { mockMax } from "../testing/mock-max.js"
import { VERSION } from "../version.js"
import { fromLine, lineReader, toLine } from "./lines.js"
import { MaxServer, type ServerEvent } from "./server.js"
import { ServerConnection, serverStatus, stopServer } from "./server-connection.js"
import { serverEnvironment } from "./start.js"
import { subscribe } from "./subscribe.js"

const ME = 10000001

/** The first login goes through; every later one is refused with this. */
const refusedAfterFirst = (refusal: string) => {
  let logins = 0
  return () => {
    logins += 1
    return logins > 1 ? refusal : undefined
  }
}

const scripted = (
  overrides: Parameters<typeof mockMax>[0]["answers"] = {},
  refuse: Parameters<typeof mockMax>[0]["refuse"] = {},
) =>
  mockMax({
    refuse,
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: ME, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [{ id: 111, title: "First", type: "CHAT", lastEventTime: 1789776000000 }],
        contacts: [{ id: 10000002, names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
      },
      [Opcode.PING]: {},
      [Opcode.LOG]: {},
      [Opcode.CHAT_HISTORY]: {
        messages: [{ id: 116762160362694583n, time: 1789776000000, sender: 10000002, text: "hi", attaches: [] }],
      },
      [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
      [Opcode.MSG_SEND]: { message: { id: 116762160362694599n, time: 1789776001000, sender: ME, text: "sent" } },
      [Opcode.MSG_DELETE]: {},
      [Opcode.FOLDERS_GET]: { folders: [], folderSync: 1_789_000_000_000 },
      [Opcode.BANNERS_GET]: { banners: [] },
      [Opcode.CALL_HISTORY]: { callHistoryItems: [], callHistorySync: 1_788_000_000_000 },
      [Opcode.ASSETS_UPDATE]: { sync: 1_789_776_000_000, sections: [] },
      ...overrides,
    },
  })

const running: MaxServer[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

const serve = async (
  profile: string,
  max = scripted(),
  extra: {
    pingEveryMs?: number
    telemetryAfterMs?: number
    refreshEveryMs?: number
    idleMs?: number
    startedByCommand?: boolean
  } = {},
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

/** One request straight to the socket, as any process of the owner's could write it. */
const ask = async (store: SessionStore, request: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const socket = await import("node:net").then(({ connect }) => connect(store.socketPath()))
  const answer = await new Promise<Record<string, unknown>>((resolve) => {
    socket.on(
      "data",
      lineReader((line) => resolve(fromLine(line))),
    )
    socket.write(toLine(request))
  })
  socket.destroy()
  return answer
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

  it("reports the chat list once, as a hidden web tab does, and not again after a reconnect", async () => {
    const started = Date.now()
    const { max } = await serve("s-telemetry", scripted(), { telemetryAfterMs: 20 })
    await settle(80)
    max.drop()
    await settle(80)

    const logs = max.sent.filter((call) => call.opcode === Opcode.LOG)
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(2)
    expect(logs).toHaveLength(1)
    const [event] = (logs[0]?.payload.events ?? []) as Record<string, unknown>[]
    expect(event).toMatchObject({
      type: "NAV",
      userId: ME,
      event: "GO",
      params: { action_id: 1, screen_to: 150, prev_time: 0, source_id: ME },
    })
    expect(event?.sessionId).toBeGreaterThanOrEqual(started)
    expect(event?.time).toBeGreaterThan(event?.sessionId as number)

    // The captured frame: 144 bytes unpacked for an 8-digit user id, ids wrapped, times plain.
    const frame = max.wire[max.sent.findIndex((call) => call.opcode === Opcode.LOG)] as Uint8Array
    const { flags, length } = decodeHeader(frame)
    const body = frame.subarray(HEADER_BYTES, HEADER_BYTES + length)
    const unpacked = flags ? decompressBlock(body, flags * length) : body
    const raw = decode(unpacked, { useBigInt64: true }) as { events: Record<string, unknown>[] }
    expect(unpacked.length).toBe(144)
    expect(raw.events[0]?.userId).toBeInstanceOf(ExtData)
    expect(typeof raw.events[0]?.time).toBe("bigint")
  })

  it("keeps running when MAX does not answer the telemetry", async () => {
    const silent = scripted({ [Opcode.LOG]: () => undefined })
    const { server, notes } = await serve("s-telemetry-silent", silent, { telemetryAfterMs: 0 })
    await settle(300)

    expect(notes.some((line) => line.startsWith("telemetry was not sent"))).toBe(true)
    expect(server.connected).toBe(true)
  })

  it("does not report the chat list before its time", async () => {
    const { max } = await serve("s-telemetry-wait", scripted(), { telemetryAfterMs: 60_000 })
    await settle(50)

    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.LOG)
  })

  it("reads what a web tab reads after its login, and after the next one sends back the sync each answer gave", async () => {
    const { max } = await serve("s-tab-reads")
    await settle(60)
    max.drop()
    await settle(80)

    const sentAs = (opcode: number) => max.sent.filter((call) => call.opcode === opcode).map((call) => call.payload)
    expect(sentAs(Opcode.FOLDERS_GET)).toEqual([{ folderSync: 0 }, { folderSync: 1_789_000_000_000 }])
    expect(sentAs(Opcode.BANNERS_GET)).toEqual([{ bannersSync: 0 }, { bannersSync: 0 }])
    expect(sentAs(Opcode.CALL_HISTORY)).toEqual([{ callHistorySync: 0 }, { callHistorySync: 1_788_000_000_000 }])
    const types = ["STICKER", "FAVORITE_STICKER", "REACTION", "ANIMOJI_SET"]
    expect(sentAs(Opcode.ASSETS_UPDATE)).toEqual([
      ...types.map((type) => ({ type, sync: 0 })),
      ...types.map((type) => ({ type, sync: 1_789_776_000_000 })),
    ])
  })

  it("keeps running when MAX refuses the reads after login", async () => {
    const refusing = scripted({}, { [Opcode.ASSETS_UPDATE]: "some.error" })
    const { server, notes } = await serve("s-tab-reads-refused", refusing)
    await settle(60)

    expect(notes.some((line) => line.startsWith("the reads after login were not all answered"))).toBe(true)
    expect(server.connected).toBe(true)
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

  it.each([
    ["the rate limit", "error.limit.violate"],
    ["a refusal it does not recognise", "some.new.error"],
  ])("stops, and logs in no more, when MAX refuses the login after a drop with %s", async (_, refusal) => {
    const { server, max } = await serve(
      `s-refused-${refusal}`,
      scripted({}, { [Opcode.LOGIN]: refusedAfterFirst(refusal) }),
    )
    const stopped = expect(server.done).rejects.toThrow(refusal)

    max.drop()
    await settle(60)

    await stopped
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(2)
  })

  it("stops when its background login is refused, instead of trying again every minute", async () => {
    const { server, max } = await serve(
      "c-refresh-refused",
      scripted({}, { [Opcode.LOGIN]: refusedAfterFirst("error.limit.violate") }),
      { refreshEveryMs: 0 },
    )
    const stopped = expect(server.done).rejects.toThrow("error.limit.violate")

    max.push(142, { chatId: 111, messageIds: [1] }, 9)
    await settle(60)

    await stopped
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

    expect(await serverStatus(store.socketPath())).toMatchObject({
      connected: true,
      byHand: true,
      pid: process.pid,
      version: VERSION,
    })
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

  it("hands MAX an id wrapped as the web client wraps it, however it crossed to the server", async () => {
    const { store, max } = await serve("c-wrapped")
    const { client } = commandClient(store)

    await client.messages.list("111", { limit: 1 })
    await client.close()

    const index = max.sent.findIndex((call) => call.opcode === Opcode.CHAT_HISTORY)
    const frame = max.wire[index] as Uint8Array
    const { flags, length } = decodeHeader(frame)
    const body = frame.subarray(HEADER_BYTES, HEADER_BYTES + length)
    const raw = decode(flags ? decompressBlock(body, flags * length) : body, { useBigInt64: true }) as {
      chatId: unknown
    }
    expect(raw.chatId).toBeInstanceOf(ExtData)
  })

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

  it("hands a message sent through it to the watchers, once, since MAX does not push it back", async () => {
    const { store } = await serve("c-send-watched")
    const watch = watching(store)
    await settle()
    const { client } = commandClient(store)

    await client.messages.send("111", "sent")
    await client.messages.send("111", "sent", { cid: 1 })
    await client.close()
    await settle()
    watch.stop()
    await watch.listening

    const messages = watch.events.filter((event) => event.event === "message")
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ message: { id: "116762160362694599", outgoing: true, chatTitle: "First" } })
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

  it("logs in again after a deletion sent through it, since MAX does not push that back either", async () => {
    const { store, max } = await serve("c-delete", scripted(), { refreshEveryMs: 0 })
    const { client } = commandClient(store)

    await client.messages.delete("111", ["116762160362694583"])
    await client.close()
    await settle(60)

    expect(max.sent.filter((call) => call.opcode === Opcode.MSG_DELETE)).toHaveLength(1)
    expect(max.sent.filter((call) => call.opcode === Opcode.LOGIN)).toHaveLength(2)
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

  it("keeps a refreshed token in the keyring and hands no token to whoever asks the socket for its login", async () => {
    const rotating = scripted({
      [Opcode.LOGIN]: {
        profile: { contact: { id: ME, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [],
        token: "the-rotated-one",
      },
    })
    const { store } = await serve("c-no-token", rotating)
    const socket = await import("node:net").then(({ connect }) => connect(store.socketPath()))
    const answer = await new Promise<string>((resolve) => {
      let text = ""
      socket.on("data", (data) => {
        text += String(data)
        if (text.includes("\n")) resolve(text)
      })
      socket.write(`${JSON.stringify({ id: 1, login: true })}\n`)
    })
    socket.destroy()

    expect(store.readToken()).toBe("the-rotated-one")
    expect(answer).toContain("Test Person")
    expect(answer).not.toContain("the-rotated-one")
    expect(answer).not.toMatch(/"token"/)
  })

  it("refuses an opcode no command sends, whoever asks the socket directly", async () => {
    const { store, max } = await serve("c-raw-52")

    const answer = await ask(store, { id: 1, opcode: 52, payload: { chatId: 111n } })

    expect(answer.error).toMatchObject({ code: "not_allowed" })
    expect(max.sent.map((call) => call.opcode)).not.toContain(52)
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

describe("the send guard, in the server", () => {
  const cli = async (argv: string[]) => {
    const streams = captureStreams()
    return run(argv, { streams, tty: false })
  }

  const journal = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

  it("refuses a send over the socket on a read-only profile, before MAX, and journals the refusal", async () => {
    await cli(["g-ro", "config", "set", "readOnly", "true"])
    const { store, max } = await serve("g-ro")

    const answer = await ask(store, {
      id: 1,
      opcode: Opcode.MSG_SEND,
      payload: { chatId: 111n, message: { cid: 7, text: "hi", attaches: [] }, notify: true },
    })

    expect(answer.error).toMatchObject({ code: "permission_error", guard: true })
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.MSG_SEND)
    expect(journal("g-ro")).toMatchObject([{ chatId: "111", outcome: "refused", errorCode: "permission_error" }])
  })

  it("reads the configuration for every write, so read-only needs no restart", async () => {
    const { store, max } = await serve("g-later")
    const send = (cid: number) =>
      ask(store, {
        id: cid,
        opcode: Opcode.MSG_SEND,
        payload: { chatId: 111n, message: { cid, text: "hi", attaches: [] }, notify: true },
      })

    expect((await send(1)).error).toBeUndefined()
    await cli(["g-later", "config", "set", "readOnly", "true"])
    expect((await send(2)).error).toMatchObject({ code: "permission_error" })
    expect(max.sent.filter((call) => call.opcode === Opcode.MSG_SEND)).toHaveLength(1)
  })

  it("refuses a delete to a chat that is not on the recipient list, and a send with no chat at all", async () => {
    new RecipientList(recipientsPathFor("g-list")).add({ id: "222", title: "Other", addedAt: new Date().toISOString() })
    const { store, max } = await serve("g-list")

    const deleted = await ask(store, {
      id: 1,
      opcode: Opcode.MSG_DELETE,
      payload: { chatId: 111n, messageIds: [116762160362694583n], forMe: false },
    })
    const unaddressed = await ask(store, {
      id: 2,
      opcode: Opcode.MSG_SEND,
      payload: { message: { cid: 8, text: "hi", attaches: [] }, notify: true },
    })

    expect(deleted.error).toMatchObject({ code: "confirmation_required" })
    expect(unaddressed.error).toMatchObject({ code: "validation_error" })
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.MSG_DELETE)
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.MSG_SEND)
  })

  it("a command's send through it leaves one journal line, written by the server", async () => {
    const { store } = await serve("g-one")
    const context = contextFor({ profile: "g-one" }, { store: () => store, streams: captureStreams() })
    const client = context.createClient()

    await client.messages.send("111", "sent")
    await client.close()

    expect(journal("g-one")).toMatchObject([
      { chatId: "111", outcome: "sent", messageId: "116762160362694599", length: 4 },
    ])
  })

  it("a refusal by the server reaches the command as the same error, with its exit code", async () => {
    const { store } = await serve("g-exit")
    const context = contextFor({ profile: "g-exit" }, { store: () => store, streams: captureStreams() })
    const client = context.createClient()
    await cli(["g-exit", "config", "set", "sendsPerHour", "1"])
    await client.messages.send("111", "one")

    await expect(client.messages.send("111", "two")).rejects.toMatchObject({ code: "rate_limited" })
    await client.close()
  })

  it("a send retried with the same cid after no answer is one message: counted once toward the limit", async () => {
    let sends = 0
    const max = scripted({
      [Opcode.MSG_SEND]: () => {
        sends += 1
        return sends === 1
          ? undefined
          : { message: { id: 116762160362694599n, time: 1789776001000, sender: ME, text: "sent" } }
      },
    })
    const { store } = await serve("g-retry", max)
    await cli(["g-retry", "config", "set", "sendsPerHour", "2"])
    const context = contextFor({ profile: "g-retry" }, { store: () => store, streams: captureStreams() })
    const client = context.createClient()

    await client.messages.send("111", "sent")
    await client.messages.send("111", "second")
    await expect(client.messages.send("111", "third")).rejects.toMatchObject({ code: "rate_limited" })
    await client.close()

    const [unknown, sent] = journal("g-retry")
    expect(unknown).toMatchObject({ outcome: "outcome_unknown" })
    expect(sent).toMatchObject({ outcome: "sent", cid: unknown?.cid })
    expect(sends).toBe(3)
  })

  it("counts a cid that was already sent as a new send, in its own chat or another", async () => {
    const { store, max } = await serve("g-reuse")
    await cli(["g-reuse", "config", "set", "sendsPerHour", "1"])
    const context = contextFor({ profile: "g-reuse" }, { store: () => store, streams: captureStreams() })
    const client = context.createClient()
    await client.messages.send("111", "sent")
    await client.close()
    const cid = journal("g-reuse")[0]?.cid
    const reuse = (chatId: bigint) =>
      ask(store, {
        id: 1,
        opcode: Opcode.MSG_SEND,
        payload: { chatId, message: { cid, text: "again", attaches: [] }, notify: true },
      })

    expect((await reuse(222n)).error).toMatchObject({ code: "rate_limited" })
    expect((await reuse(111n)).error).toMatchObject({ code: "rate_limited" })
    expect(max.sent.filter((call) => call.opcode === Opcode.MSG_SEND)).toHaveLength(1)
    expect(journal("g-reuse").map((entry) => entry.outcome)).toEqual(["sent", "refused", "refused"])
  })

  it("refuses a request shape no command sends: a field the spec does not have, a control attachment in a message", async () => {
    await cli(["g-shape", "config", "set", "allow", "send"])
    const { store, max } = await serve("g-shape")

    const extra = await ask(store, {
      id: 1,
      opcode: Opcode.MSG_SEND,
      payload: { chatId: 111n, message: { cid: 9, text: "hi", attaches: [] }, notify: true, silent: true },
    })
    const control = await ask(store, {
      id: 2,
      opcode: Opcode.MSG_SEND,
      payload: {
        chatId: 111n,
        message: { cid: 10, attaches: [{ _type: "CONTROL", event: "add", userIds: [3n] }] },
        notify: true,
      },
    })

    expect(extra.error).toMatchObject({ code: "validation_error" })
    expect(control.error).toMatchObject({ code: "validation_error" })
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.MSG_SEND)
  })

  it("drops a client whose line never ends", async () => {
    const { store } = await serve("g-long")
    const socket = await import("node:net").then(({ connect }) => connect(store.socketPath()))
    const closed = new Promise((resolve) => socket.once("close", resolve))
    socket.on("error", () => {})
    socket.write("x".repeat(2 * 1024 * 1024))

    await closed
  })

  it("keeps its socket's directory to the owner, even one that was there before", async () => {
    const store = new SessionStore({ profile: "g-dir", keyring: memoryKeyring() })
    mkdirSync(dirname(store.socketPath()), { recursive: true, mode: 0o755 })
    chmodSync(dirname(store.socketPath()), 0o755)
    await serve("g-dir")

    expect(statSync(dirname(store.socketPath())).mode & 0o777).toBe(0o700)
  })
})

describe("the background server's environment", () => {
  it("carries the profile and not MAX_TOKEN, which it would keep long after the command", () => {
    const env = serverEnvironment({ MAX_TOKEN: "a-token", PATH: "/bin" }, "work")

    expect(env).toEqual({ PATH: "/bin", MAX_PROFILE: "work" })
  })
})

describe("max server", () => {
  const max = async (argv: string[]) => {
    const streams = captureStreams()
    const code = await run(argv, { streams, tty: false })
    return { code, out: streams.stdout.join(""), err: streams.stderr.join("") }
  }

  it("status: says nothing runs, as a result a script can read, and exits 0", async () => {
    const { code, out } = await max(["x-none", "server", "status", "--json"])
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ profile: "x-none", running: false })
  })

  it("status: pid, start time, version and whether MAX is connected", async () => {
    await serve("x-status")
    const { code, out, err } = await max(["x-status", "server", "status", "--json"])

    expect(code).toBe(0)
    expect(JSON.parse(out)).toMatchObject({
      profile: "x-status",
      running: true,
      connected: true,
      pid: process.pid,
      byHand: true,
      version: VERSION,
      cliVersion: VERSION,
    })
    expect(Date.parse(JSON.parse(out).startedAt)).toBeLessThanOrEqual(Date.now())
    expect(err).toBe("")
  })

  it("status: names a server left from another version, and the command that replaces it", async () => {
    const store = new SessionStore({ profile: "x-old", keyring: memoryKeyring() })
    const old = createServer((socket) =>
      socket.on(
        "data",
        lineReader(() => socket.write(toLine({ event: "status", connected: true, byHand: false, version: "0.8.0" }))),
      ),
    )
    await new Promise<void>((resolve) => old.listen(store.socketPath(), resolve))

    const { out, err } = await max(["x-old", "server", "status", "--json"])
    old.close()

    expect(JSON.parse(out)).toMatchObject({ running: true, version: "0.8.0", cliVersion: VERSION })
    expect(err).toContain("max server restart")
  })

  it("stop: stops one started by hand, and says so", async () => {
    const { server } = await serve("x-stop")
    const { code, out } = await max(["x-stop", "server", "stop", "--json"])

    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ profile: "x-stop", stopped: true })
    await expect(server.done).resolves.toBeUndefined()
  })

  it("stop: with nothing running, stopped is false and a note says why", async () => {
    const { out, err } = await max(["x-idle", "server", "stop", "--json"])
    expect(JSON.parse(out)).toEqual({ profile: "x-idle", stopped: false })
    expect(err).toContain("no server is running")
  })
})

describe("starting a server in the background", () => {
  it("stops one a command started under another version, and leaves one started by hand", async () => {
    const { replacedIfStale } = await import("./start.js")
    const oldOne = new SessionStore({ profile: "v-old", keyring: memoryKeyring() })
    const byHand = new SessionStore({ profile: "v-hand", keyring: memoryKeyring() })
    const stops: string[] = []
    const fake = (store: SessionStore, status: Record<string, unknown>) => {
      const server = createServer((socket) =>
        socket.on(
          "data",
          lineReader((line) => {
            const request = fromLine(line)
            if (request.stop === true) {
              stops.push(store.profile)
              socket.end(toLine({ id: request.id, stopped: true }))
            } else socket.write(toLine({ event: "status", ...status }))
          }),
        ),
      )
      return new Promise<Server>((resolve) => server.listen(store.socketPath(), () => resolve(server)))
    }
    const servers = [
      await fake(oldOne, { version: "0.0.1", byHand: false }),
      await fake(byHand, { version: "0.0.1", byHand: true }),
    ]

    expect(await replacedIfStale(oldOne)).toBe(true)
    expect(await replacedIfStale(byHand)).toBe(false)
    expect(stops).toEqual(["v-old"])
    for (const server of servers) server.close()
  })

  it("does not try again for a while after MAX refused the login", async () => {
    const { refusedPath, startInBackground } = await import("./start.js")
    const store = new SessionStore({ profile: "b-refused", keyring: memoryKeyring() })
    store.writeToken("a-token")
    writeFileSync(refusedPath(store), "")

    expect(startInBackground(store, { entry: "/nonexistent/max.js" })).toBeUndefined()
    expect(existsSync(`${store.socketPath()}.starting`)).toBe(false)
  })
})
