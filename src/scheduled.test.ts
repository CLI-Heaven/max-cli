import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { sendTime } from "./commands/messages.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const MINUTE = 60_000
const FIRE = 1_790_285_820_000

const messenger = ({ send }: { send?: () => undefined } = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: { profile: { contact: { id: 10000001 } }, chats: [{ id: 111, title: "Friends", type: "CHAT" }] },
      [Opcode.MSG_SEND]:
        send ??
        ((request) => ({
          message: {
            id: 117328171499542309n,
            time: 1789776000000,
            sender: 10000001,
            text: "later",
            delayedAttributes: { ...(request.message as { delayedAttributes: object }).delayedAttributes },
          },
        })),
      [Opcode.CHAT_HISTORY]: {
        messages: [
          { id: 2n, time: 1, sender: 10000001, text: "second", delayedAttributes: { timeToFire: FIRE + MINUTE } },
          { id: 1n, time: 1, sender: 10000001, text: "first", delayedAttributes: { timeToFire: FIRE } },
        ],
      },
    },
  })
  const keyring = memoryKeyring()
  const environment: Environment = {
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  }
  const sentWith = (opcode: number) => max.sent.filter((request) => request.opcode === opcode)
  return { max, environment, sentWith }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const fireOf = (payload: unknown) =>
  (payload as { message: { delayedAttributes?: { timeToFire: number } } }).message.delayedAttributes?.timeToFire

describe("sending later with --at", () => {
  it("queues it on MAX with timeToFire rounded down to the minute, and answers scheduledFor", async () => {
    const { environment, sentWith } = messenger()
    const before = Date.now()
    const sent = await runWith(["s-later", "messages", "send", "111", "later", "--at", "30m", "--json"], environment)

    expect(sent.code).toBe(0)
    const [request] = sentWith(Opcode.MSG_SEND)
    const fire = fireOf(request?.payload) ?? 0
    expect(fire % MINUTE).toBe(0)
    expect(fire).toBeGreaterThan(before + 29 * MINUTE)
    expect(fire).toBeLessThanOrEqual(Date.now() + 30 * MINUTE)
    expect(request?.payload).toMatchObject({ notify: true })
    expect(JSON.parse(sent.stdout).scheduledFor).toBe(new Date(fire).toISOString())
    expect(sent.stderr).toContain("scheduled for")
    expect(new SendJournal(sendsPathFor("s-later")).entries()).toMatchObject([
      { outcome: "sent", scheduledFor: new Date(fire).toISOString() },
    ])
  })

  it("reads a delay in minutes, hours or days", () => {
    const now = Date.parse("2026-09-24T12:00:00Z")
    expect(sendTime("90m", now) - now).toBe(90 * MINUTE)
    expect(sendTime("2h", now) - now).toBe(120 * MINUTE)
    expect(sendTime("1d", now) - now).toBe(24 * 60 * MINUTE)
  })

  it("reads a time without an offset as local time", () => {
    const now = Date.parse("2026-09-24T12:00:00")
    expect(sendTime("2026-09-25T09:00", now)).toBe(Date.parse("2026-09-25T09:00:00"))
    expect(sendTime("2026-09-25 09:00:45", now)).toBe(Date.parse("2026-09-25T09:00:00"))
  })

  it.each([
    ["the past", "2020-01-01T09:00"],
    ["less than a minute ahead", "0m"],
    ["seconds, which MAX drops", "90s"],
    ["more than a year ahead", "2030-01-01T09:00"],
    ["neither a time nor a delay", "tomorrow"],
  ])("refuses %s before connecting", async (_, at) => {
    const { max, environment } = messenger()
    const refused = await runWith(["s-bad", "messages", "send", "111", "later", "--at", at], environment)

    expect(refused.code).toBe(2)
    expect(max.sent).toEqual([])
  })

  it("refuses --silent, which MAX's own client never sends with a scheduled message", async () => {
    const { environment, sentWith } = messenger()
    const refused = await runWith(["s-silent", "messages", "send", "111", "x", "--at", "1h", "--silent"], environment)

    expect(refused.code).toBe(2)
    expect(JSON.parse(refused.stderr).error.message).toContain("cannot be silent")
    expect(sentWith(Opcode.MSG_SEND)).toEqual([])
  })

  it("does not repeat a lost scheduled send, and points at the queue instead", async () => {
    const { environment, sentWith } = messenger({ send: () => undefined })
    const lost = await runWith(["s-lost", "messages", "send", "111", "later", "--at", "1h"], environment)

    expect(sentWith(Opcode.MSG_SEND)).toHaveLength(1)
    const { error } = JSON.parse(lost.stderr)
    expect(error.code).toBe("outcome_unknown")
    expect(error.message).toContain("max messages scheduled 111")
  })

  it("is refused by a read-only profile like any other send", async () => {
    const { max, environment } = messenger()
    await runWith(["s-read", "config", "set", "readOnly", "true"])

    expect((await runWith(["s-read", "messages", "send", "111", "x", "--at", "1h"], environment)).code).toBe(5)
    expect(max.sent).toEqual([])
  })
})

describe("messages scheduled", () => {
  it("reads the DELAYED queue, soonest first, and never marks anything read", async () => {
    const { max, environment, sentWith } = messenger()
    const listed = await runWith(["s-queue", "messages", "scheduled", "111", "--json"], environment)

    expect(listed.code).toBe(0)
    expect(sentWith(Opcode.CHAT_HISTORY)[0]?.payload).toMatchObject({ itemType: "DELAYED", from: 1, backward: 0 })
    expect(
      JSON.parse(listed.stdout).map((m: { text: string; scheduledFor: string }) => [m.text, m.scheduledFor]),
    ).toEqual([
      ["first", new Date(FIRE).toISOString()],
      ["second", new Date(FIRE + MINUTE).toISOString()],
    ])
    expect(max.sent.some((request) => request.opcode === Opcode.CHAT_MARK)).toBe(false)
  })
})
