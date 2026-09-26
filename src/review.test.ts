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
const THEM = 10000002
const now = Date.now()

type Wire = { id: bigint; time: number; sender: number; text: string; attaches: object[] }

const message = (minutesAgo: number, sender: number, text: string, attaches: object[] = []): Wire => {
  const time = now - minutesAgo * 60 * 1000
  return { id: (BigInt(time) << 16n) + 1n, time, sender, text, attaches }
}

/** History that honours `from` and `forward`, as MAX does, so paging is exercised for real. */
const reviewMax = (histories: Record<number, Wire[]>, { lastEventMinutesAgo = {} as Record<number, number> } = {}) => {
  const chats = Object.entries(histories).map(([id, messages]) => ({
    id: Number(id),
    title: `Chat ${id}`,
    type: "CHAT",
    lastEventTime:
      lastEventMinutesAgo[Number(id)] === undefined
        ? Math.max(...messages.map((m) => m.time))
        : now - (lastEventMinutesAgo[Number(id)] ?? 0) * 60 * 1000,
  }))
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: ME, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats,
        contacts: [{ id: THEM, names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
      },
      [Opcode.CHAT_HISTORY]: (request: Payload) => {
        const from = Number(request.from)
        const forward = Number(request.forward ?? 0)
        const all = histories[Number(request.chatId)] ?? []
        return { messages: all.filter((m) => m.time >= from).slice(0, forward) }
      },
      [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
      [Opcode.CHATS_LIST]: { chats: [] },
    },
  })
  const keyring = memoryKeyring()
  const environment: Environment = {
    store: (profile) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  }
  const historiesAsked = () => max.sent.filter((call) => call.opcode === Opcode.CHAT_HISTORY).length
  return { max, environment, historiesAsked }
}

const review = async (argv: string[], environment: Environment) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, json: JSON.parse(streams.stdout.join("\n") || "null"), stderr: streams.stderr.join("\n") }
}

const texts = (chat: { messages: { text: string }[] }) => chat.messages.map((m) => m.text)
const since = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString()

describe("max review", () => {
  it("reads both sides of every chat that changed, and nothing from before or from quiet chats", async () => {
    const { max, environment } = reviewMax({
      111: [message(300, THEM, "old"), message(50, THEM, "can you send it?"), message(40, ME, "I'll send it Friday")],
      222: [message(500, THEM, "quiet chat")],
    })

    const { code, json } = await review(["r-both", "review", "--since", since(60), "--json"], environment)

    expect(code).toBe(0)
    expect(json.chats.map((chat: { id: string }) => chat.id)).toEqual(["111"])
    expect(texts(json.chats[0])).toEqual(["can you send it?", "I'll send it Friday"])
    expect(json.chats[0].messages[1].outgoing).toBe(true)
    expect(json).toMatchObject({ complete: true, skipped: [], unheard: [], until: since(40) })
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
  })

  it("stops at the chat list's moment, so what arrives during the review waits for the next one", async () => {
    const { environment } = reviewMax(
      { 111: [message(30, THEM, "before the login"), message(1, THEM, "during the review")] },
      { lastEventMinutesAgo: { 111: 30 } },
    )

    const { json } = await review(["r-cut", "review", "--since", since(60), "--json"], environment)

    expect(texts(json.chats[0])).toEqual(["before the login"])
    expect(json.until).toBe(since(30))
  })

  it("pages forward through a busy chat instead of taking only the newest", async () => {
    const busy = Array.from({ length: 150 }, (_, i) => message(200 - i, THEM, `m${i}`))
    const { environment, historiesAsked } = reviewMax({ 111: busy })

    const { json } = await review(["r-busy", "review", "--since", since(201), "--json"], environment)

    expect(json.chats[0].messages).toHaveLength(150)
    expect(json.chats[0].more).toBe(false)
    expect(historiesAsked()).toBe(2)
  })

  it("looks back three days without --since", async () => {
    const { environment } = reviewMax({
      111: [message(4 * 24 * 60, THEM, "four days ago"), message(2 * 24 * 60, THEM, "two days ago")],
    })

    const { json } = await review(["r-default", "review", "--json"], environment)

    expect(texts(json.chats[0])).toEqual(["two days ago"])
  })

  it("lists an unheard voice message and calls the review incomplete; --transcribe without a model still answers", async () => {
    const voice = message(10, THEM, "", [{ _type: "AUDIO", audioId: 5, duration: 3000, url: "https://x" }])
    const { environment } = reviewMax({ 111: [voice] })

    const plain = await review(["r-voice", "review", "--since", since(60), "--json"], environment)
    const asked = await review(["r-voice", "review", "--since", since(60), "--transcribe", "--json"], environment)

    expect(plain.json).toMatchObject({ complete: false, unheard: [{ chatId: "111", messageId: String(voice.id) }] })
    expect(asked.code).toBe(0)
    expect(asked.json.transcribeProblem).toMatch(/max models audio download/)
    expect(asked.stderr).toContain("incomplete")
  })
})
