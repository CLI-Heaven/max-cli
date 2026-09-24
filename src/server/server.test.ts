import { existsSync, statSync, writeFileSync } from "node:fs"
import { memoryKeyring } from "@leemour/cli-core"
import { afterEach, describe, expect, it } from "vitest"
import { Opcode } from "../generated/opcodes.generated.js"
import { Connection } from "../protocol/connection.js"
import { SessionStore } from "../session/store.js"
import { mockMax } from "../testing/mock-max.js"
import { MaxServer, type ServerEvent } from "./server.js"
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
    },
  })

const running: MaxServer[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

const serve = async (profile: string, max = scripted(), extra: { pingEveryMs?: number } = {}) => {
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
    await settle(45)

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
