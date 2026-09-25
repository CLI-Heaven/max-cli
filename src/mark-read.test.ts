import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { timeOfMessageId } from "./client.js"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const OLDER = "116762160362694580"
const NEWER = "116762160362694583"

const messenger = () => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001 } },
        chats: [
          { id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 },
          { id: 222, title: "Strangers", type: "CHAT", lastEventTime: 1789775000000 },
        ],
      },
      [Opcode.CONTACT_INFO]: { contacts: [] },
      [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
      [Opcode.CHAT_HISTORY]: {
        messages: [
          { id: BigInt(OLDER), time: 1789775000000, sender: 20000002, text: "one", attaches: [] },
          { id: BigInt(NEWER), time: 1789776000000, sender: 20000002, text: "two", attaches: [] },
        ],
      },
      [Opcode.CHAT_MARK]: { unread: 0, mark: 1789776100000 },
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
  const marks = () =>
    max.sent
      .filter(({ opcode }) => opcode === Opcode.CHAT_MARK)
      .map(({ payload }) => ({ ...payload, chatId: String(payload.chatId), messageId: String(payload.messageId) }))
  return { max, environment, marks }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run([...argv, "--json"], { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const journalOf = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

describe("marking a chat read", () => {
  it("`messages list` without the flag marks nothing", async () => {
    const { environment, marks } = messenger()
    expect((await runWith(["r-plain", "messages", "list", "111"], environment)).code).toBe(0)
    expect(marks()).toEqual([])
  })

  it("`messages list --mark-read` marks up to the newest message shown, once, and still prints the listing", async () => {
    const { environment, marks } = messenger()
    const { code, stdout, stderr } = await runWith(["r-list", "messages", "list", "111", "--mark-read"], environment)

    expect(code).toBe(0)
    expect(marks()).toEqual([{ type: "READ_MESSAGE", chatId: "111", messageId: NEWER, mark: expect.any(Number) }])
    expect(JSON.parse(stdout).items.map(({ id }: { id: string }) => id)).toEqual([OLDER, NEWER])
    expect(stderr).toContain(`marked read up to ${NEWER}`)
    expect(journalOf("r-list")).toMatchObject([{ chatId: "111", kind: "read", outcome: "sent", messageId: NEWER }])
  })

  it("`chats read` marks up to the newest message, or to the one given", async () => {
    const { environment, marks } = messenger()
    const newest = await runWith(["r-chat", "chats", "read", "111"], environment)
    const given = await runWith(["r-chat", "chats", "read", "Friends", "--until", OLDER], environment)

    expect(newest.code).toBe(0)
    expect(JSON.parse(newest.stdout)).toEqual({ chatId: "111", messageId: NEWER, unread: 0 })
    expect(given.code).toBe(0)
    expect(marks().map(({ messageId }) => messageId)).toEqual([NEWER, OLDER])
  })

  it("marks with the read message's own time, as the web client does, so nothing newer is marked", async () => {
    const { max, environment } = messenger()
    await runWith(["r-time", "chats", "read", "111", "--until", OLDER], environment)
    await runWith(["r-time", "chats", "read", "111"], environment)

    const marks = max.sent.filter(({ opcode }) => opcode === Opcode.CHAT_MARK).map(({ payload }) => payload.mark)
    expect(marks).toEqual([timeOfMessageId(OLDER), timeOfMessageId(NEWER)])
  })

  it("a read-only profile refuses before connecting, and prints no messages", async () => {
    const { max, environment } = messenger()
    await runWith(["r-ro", "config", "set", "readOnly", "true"])

    expect((await runWith(["r-ro", "chats", "read", "111"], environment)).code).toBe(5)
    expect(max.sent).toEqual([])

    const listed = await runWith(["r-ro", "messages", "list", "111", "--mark-read"], environment)
    expect(listed.code).toBe(5)
    expect(listed.stdout).toBe("")
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.CHAT_MARK)
  })

  it("a chat outside the recipient list is refused", async () => {
    const { environment, marks } = messenger()
    await runWith(["r-list-off", "recipients", "add", "222"], environment)

    expect((await runWith(["r-list-off", "chats", "read", "111"], environment)).code).toBe(7)
    expect(marks()).toEqual([])
  })

  it("`--offline` refuses: marking is a change on MAX", async () => {
    const { environment, marks } = messenger()
    const { code } = await runWith(["r-off", "chats", "read", "111", "--offline"], environment)
    expect(code).toBe(2)
    expect(marks()).toEqual([])
  })
})
