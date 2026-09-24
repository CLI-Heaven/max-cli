import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import type { Payload } from "./protocol/frame.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const ME = 10000001
const HOUR = 60 * 60 * 1000
const now = Date.now()

/** A message whose id carries its own time, as MAX's do. */
const message = (minutesAgo: number, sender: number, text: string) => {
  const time = now - minutesAgo * 60 * 1000
  return { id: (BigInt(time) << 16n) + 1n, time, sender, text, attaches: [] }
}

/**
 * Chats by id, each with its history. A chat's last event at login is its newest message, unless
 * the test says the login saw an earlier one — a message that arrives between the login and the
 * history read.
 */
const inboxMax = (
  histories: Record<number, ReturnType<typeof message>[]>,
  { lastEventMinutesAgo = {} as Record<number, number>, unread = {} as Record<number, number> } = {},
) => {
  const chats = Object.entries(histories).map(([id, messages]) => ({
    id: Number(id),
    title: `Chat ${id}`,
    type: "CHAT",
    lastEventTime:
      lastEventMinutesAgo[Number(id)] === undefined
        ? Math.max(...messages.map((m) => m.time))
        : now - (lastEventMinutesAgo[Number(id)] ?? 0) * 60 * 1000,
    newMessages: unread[Number(id)] ?? 0,
  }))
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: ME, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats,
        contacts: [{ id: 10000002, names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
      },
      [Opcode.CHAT_HISTORY]: (request: Payload) => ({ messages: histories[Number(request.chatId)] ?? [] }),
    },
  })
  const keyring = memoryKeyring()
  const store = (profile: string) => {
    const store = new SessionStore({ profile, keyring })
    store.writeToken("a-token")
    return store
  }
  const environment: Environment = {
    store,
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  }
  const historiesAsked = () =>
    max.sent.filter((call) => call.opcode === Opcode.CHAT_HISTORY).map((call) => String(call.payload.chatId))
  return { max, environment, store, historiesAsked }
}

const runWith = async (argv: string[], environment: Environment, { tty = false } = {}) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

describe("max inbox — unread", () => {
  it("shows each chat's newest unread messages, and reads no chat with nothing unread", async () => {
    const { max, environment, historiesAsked } = inboxMax(
      {
        111: [
          message(300, 10000002, "read long ago"),
          message(30, 10000002, "unread 1"),
          message(20, 10000002, "unread 2"),
        ],
        222: [message(10, 10000002, "read already")],
      },
      { unread: { 111: 2 } },
    )

    const { stdout, code } = await runWith(["u-basic", "inbox", "--json"], environment)

    expect(max.unexpected).toEqual([])
    expect(code).toBe(0)
    const inbox = JSON.parse(stdout)
    expect(inbox.mode).toBe("unread")
    expect(inbox.chats[0].messages.map((m: { text: string }) => m.text)).toEqual(["unread 1", "unread 2"])
    expect(historiesAsked()).toEqual(["111"])
    expect(max.sent.find((call) => call.opcode === Opcode.CHAT_HISTORY)?.payload).toMatchObject({ backward: 2 })
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
  })

  it("answers the same twice, and never touches the saved point", async () => {
    const { environment, store } = inboxMax({ 111: [message(30, 10000002, "unread")] }, { unread: { 111: 1 } })

    const first = await runWith(["u-twice", "inbox", "--json"], environment)
    const second = await runWith(["u-twice", "inbox", "--json"], environment)

    expect(JSON.parse(second.stdout).chats).toEqual(JSON.parse(first.stdout).chats)
    expect(store("u-twice").readState().lastCheckAt).toBeUndefined()
  })

  it("shows the newest `--limit` of a long unread run and says how to read all of it", async () => {
    const { environment } = inboxMax(
      { 111: [message(30, 10000002, "a"), message(20, 10000002, "b"), message(10, 10000002, "c")] },
      { unread: { 111: 3 } },
    )

    const { stdout, stderr } = await runWith(["u-more", "inbox", "--limit", "2", "--json"], environment)

    expect(JSON.parse(stdout).chats[0]).toMatchObject({ more: true, unreadCount: 3 })
    expect(stderr).toContain("max messages list 111 --limit 3")
  })

  it("says so when nothing is unread", async () => {
    const { environment } = inboxMax({ 111: [message(30, 10000002, "read")] })

    const { stdout, stderr } = await runWith(["u-none", "inbox"], environment, { tty: true })

    expect(stdout).toBe("")
    expect(stderr).toContain("nothing unread")
  })
})

describe("max inbox --new", () => {
  it("shows other people's new messages from changed chats, and saves where it stopped", async () => {
    const { max, environment, store, historiesAsked } = inboxMax({
      111: [message(120, 10000002, "old"), message(30, 10000002, "new"), message(10, ME, "my reply")],
      222: [message(300, 10000002, "unchanged")],
    })
    store("i-first").writeState({ ...store("i-first").readState(), lastCheckAt: new Date(now - HOUR).toISOString() })

    const { stdout, code } = await runWith(["i-first", "inbox", "--new", "--json"], environment)

    expect(max.unexpected).toEqual([])
    expect(code).toBe(0)
    const inbox = JSON.parse(stdout)
    expect(inbox.chats).toHaveLength(1)
    expect(inbox.chats[0]).toMatchObject({ id: "111", more: false })
    expect(inbox.chats[0].messages.map((m: { text: string }) => m.text)).toEqual(["new"])
    expect(historiesAsked()).toEqual(["111"])
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)

    // The owner's own reply is the newest thing read, so the next check starts after it.
    expect(store("i-first").readState().lastCheckAt).toBe(new Date(now - 10 * 60 * 1000).toISOString())
  })

  it("leaves a message that arrived during the run for the next one, and does not step over it", async () => {
    const { environment, store } = inboxMax(
      { 111: [message(30, 10000002, "seen at login"), message(2, 10000002, "arrived mid-run")] },
      { lastEventMinutesAgo: { 111: 30 } },
    )
    store("i-race").writeState({ ...store("i-race").readState(), lastCheckAt: new Date(now - HOUR).toISOString() })

    const { stdout } = await runWith(["i-race", "inbox", "--new", "--json"], environment)

    expect(JSON.parse(stdout).chats[0].messages.map((m: { text: string }) => m.text)).toEqual(["seen at login"])
    expect(store("i-race").readState().lastCheckAt).toBe(new Date(now - 30 * 60 * 1000).toISOString())
  })

  it("says there is nothing new, prints nothing on stdout, and leaves the saved point alone", async () => {
    const { environment, store } = inboxMax({ 111: [message(120, 10000002, "old")] })
    const saved = new Date(now - HOUR).toISOString()
    store("i-quiet").writeState({ ...store("i-quiet").readState(), lastCheckAt: saved })

    const { stdout, stderr, code } = await runWith(["i-quiet", "inbox", "--new"], environment, { tty: true })

    expect(code).toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain("nothing new since")
    expect(store("i-quiet").readState().lastCheckAt).toBe(saved)
  })

  it("prints the conversation for a person, each message with its chat", async () => {
    const { environment } = inboxMax({ 111: [message(30, 10000002, "hello there")] })

    const { stdout } = await runWith(["i-pretty", "inbox", "--new"], environment, { tty: true })

    expect(stdout).toContain("hello there")
    expect(stdout).toContain("Chat 111")
  })

  it("looks back 24 hours the first time", async () => {
    const { environment } = inboxMax({ 111: [message(25 * 60, 10000002, "too old"), message(60, 10000002, "today")] })

    const { stdout } = await runWith(["i-fresh", "inbox", "--new", "--jsonl"], environment)

    expect(stdout.split("\n").map((line) => JSON.parse(line).text)).toEqual(["today"])
    expect(JSON.parse(stdout).chatTitle).toBe("Chat 111")
  })

  it("`--since` is a one-off look: the saved point does not move", async () => {
    const { environment, store } = inboxMax({ 111: [message(30, 10000002, "new")] })
    const saved = new Date(now - 5 * 60 * 1000).toISOString()
    store("i-since").writeState({ ...store("i-since").readState(), lastCheckAt: saved })

    const { stdout } = await runWith(
      ["i-since", "inbox", "--new", "--since", new Date(now - HOUR).toISOString(), "--json"],
      environment,
    )

    expect(JSON.parse(stdout).chats[0].messages).toHaveLength(1)
    expect(store("i-since").readState().lastCheckAt).toBe(saved)
  })

  it("shows the newest when more arrived than `--limit`, and says how to read the rest", async () => {
    const { environment } = inboxMax({
      111: [message(40, 10000002, "a"), message(30, 10000002, "b"), message(20, 10000002, "c")],
    })

    const { stdout, stderr } = await runWith(["i-more", "inbox", "--new", "--limit", "2", "--json"], environment)

    const [chat] = JSON.parse(stdout).chats
    expect(chat.more).toBe(true)
    expect(stderr).toContain("only the newest shown")
    expect(stderr).toContain("max messages list 111 --after")
  })

  it("reads at most twenty chats in one run and names the rest", async () => {
    const histories = Object.fromEntries(
      Array.from({ length: 22 }, (_, index) => [1000 + index, [message(60 - index, 10000002, `m${index}`)]]),
    )
    const { environment, historiesAsked } = inboxMax(histories)

    const { stdout, stderr } = await runWith(["i-many", "inbox", "--new", "--json"], environment)

    expect(historiesAsked()).toHaveLength(20)
    expect(JSON.parse(stdout).skipped.map((chat: { id: string }) => chat.id)).toEqual(["1001", "1000"])
    expect(stderr).toContain("too many chats at once")
  })

  it("keeps the saved point through the next login of any command", async () => {
    const { environment, store } = inboxMax({ 111: [message(30, 10000002, "new")] })

    await runWith(["i-keep", "inbox", "--new", "--json"], environment)
    const saved = store("i-keep").readState().lastCheckAt
    await runWith(["i-keep", "chats", "list", "--json"], environment)

    expect(saved).toBeDefined()
    expect(store("i-keep").readState().lastCheckAt).toBe(saved)
  })

  it("refuses `--offline` before connecting", async () => {
    const { max, environment } = inboxMax({ 111: [message(30, 10000002, "new")] })

    const { code, stderr } = await runWith(["i-offline", "--offline", "inbox"], environment)

    expect(code).not.toBe(0)
    expect(stderr).toContain("nothing new")
    expect(max.sent).toEqual([])
  })
})
