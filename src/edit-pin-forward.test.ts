import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const OWNER = 10000001
const MESSAGE = "116762160362694583"
const PHOTO = { _type: "PHOTO", photoId: 5, photoToken: "a-photo-token", baseUrl: "https://example.test/p" }

const messenger = ({ sender = OWNER, link }: { sender?: number; link?: object } = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: OWNER } },
        chats: [
          { id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 },
          { id: 222, title: "Strangers", type: "CHAT", lastEventTime: 1789775000000 },
        ],
      },
      [Opcode.CHAT_HISTORY]: {
        messages: [
          {
            id: BigInt(MESSAGE),
            time: 1789776000000,
            sender,
            text: "old",
            attaches: [PHOTO],
            ...(link ? { link } : {}),
          },
        ],
      },
      [Opcode.MSG_EDIT]: {
        message: { id: BigInt(MESSAGE), time: 1789776000000, sender, text: "new", status: "EDITED", attaches: [PHOTO] },
      },
      [Opcode.MSG_SEND]: { message: { id: 116762160362694590n, time: 1789776100000, sender: OWNER, text: "" } },
      [Opcode.CHAT_UPDATE]: { chat: { id: 111 } },
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
  const code = await run([...argv, "--json"], { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const journalOf = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

describe("editing", () => {
  it("sends the message's attachments back, so the photo stays, and journals the length, not the text", async () => {
    const { environment, sentWith } = messenger()
    const edited = await runWith(["e-edit", "messages", "edit", "111", MESSAGE, "**new**", "--md"], environment)

    expect(edited.code).toBe(0)
    expect(sentWith(Opcode.MSG_EDIT)[0]?.payload).toMatchObject({
      text: "new",
      elements: [{ type: "STRONG", from: 0, length: 3 }],
      attachments: [PHOTO],
    })
    expect(JSON.parse(edited.stdout)).toMatchObject({ id: MESSAGE, text: "new" })
    expect(journalOf("e-edit")).toMatchObject([{ chatId: "111", kind: "edit", outcome: "sent", length: 7 }])
    expect(JSON.stringify(journalOf("e-edit"))).not.toContain("new")
  })

  it("refuses somebody else's message and a forward without asking MAX to edit", async () => {
    const theirs = messenger({ sender: 20000002 })
    expect((await runWith(["e-theirs", "messages", "edit", "111", MESSAGE, "new"], theirs.environment)).code).toBe(2)
    expect(theirs.sentWith(Opcode.MSG_EDIT)).toEqual([])

    const forward = messenger({ link: { type: "FORWARD", chatId: 222, message: {} } })
    expect((await runWith(["e-fwd", "messages", "edit", "111", MESSAGE, "new"], forward.environment)).code).toBe(2)
    expect(forward.sentWith(Opcode.MSG_EDIT)).toEqual([])
  })
})

describe("forwarding", () => {
  it("sends a FORWARD link naming the source chat, with no text or markup of its own", async () => {
    const { environment, sentWith } = messenger()
    const forwarded = await runWith(
      ["e-forward", "messages", "forward", "Friends", MESSAGE, "--to", "222"],
      environment,
    )

    expect(forwarded.code).toBe(0)
    const { chatId, message } = (sentWith(Opcode.MSG_SEND)[0]?.payload ?? {}) as { chatId: unknown; message: object }
    expect(String(chatId)).toBe("222")
    expect(message).not.toHaveProperty("text")
    expect(message).not.toHaveProperty("elements")
    const { link, attaches } = message as { link: Record<string, unknown>; attaches: unknown[] }
    expect([link.type, String(link.messageId), String(link.chatId)]).toEqual(["FORWARD", MESSAGE, "111"])
    expect(attaches).toEqual([])
    expect(journalOf("e-forward")).toMatchObject([{ chatId: "222", kind: "forward", outcome: "sent" }])
  })

  it("counts against the hourly limit; an edit and a pin do not", async () => {
    const { environment, sentWith } = messenger()
    await runWith(["e-limit", "config", "set", "sendsPerHour", "1"])

    expect((await runWith(["e-limit", "messages", "forward", "111", MESSAGE, "--to", "222"], environment)).code).toBe(0)
    expect((await runWith(["e-limit", "messages", "edit", "111", MESSAGE, "new"], environment)).code).toBe(0)
    expect((await runWith(["e-limit", "messages", "pin", "111", MESSAGE], environment)).code).toBe(0)
    expect((await runWith(["e-limit", "messages", "forward", "111", MESSAGE, "--to", "222"], environment)).code).toBe(8)
    expect(sentWith(Opcode.MSG_SEND)).toHaveLength(1)
  })
})

describe("pinning", () => {
  it("pins without notifying unless asked, and unpins with message 0", async () => {
    const { environment, sentWith } = messenger()

    const pinned = await runWith(["e-pin", "messages", "pin", "111", MESSAGE], environment)
    await runWith(["e-pin", "messages", "pin", "111", MESSAGE, "--notify"], environment)
    const unpinned = await runWith(["e-pin", "messages", "unpin", "111"], environment)

    expect(JSON.parse(pinned.stdout)).toEqual({ chatId: "111", pinned: MESSAGE })
    expect(JSON.parse(unpinned.stdout)).toEqual({ chatId: "111", pinned: null })
    const requests = sentWith(Opcode.CHAT_UPDATE).map(({ payload }) => ({
      notifyPin: payload?.notifyPin,
      pinMessageId: String(payload?.pinMessageId),
    }))
    expect(requests).toEqual([
      { notifyPin: false, pinMessageId: MESSAGE },
      { notifyPin: true, pinMessageId: MESSAGE },
      { notifyPin: false, pinMessageId: "0" },
    ])
  })
})

describe("a read-only profile", () => {
  it("refuses an edit, a forward, a pin and an unpin without connecting", async () => {
    const { max, environment } = messenger()
    await runWith(["e-read", "config", "set", "readOnly", "true"])

    for (const argv of [
      ["messages", "edit", "111", MESSAGE, "new"],
      ["messages", "forward", "111", MESSAGE, "--to", "222"],
      ["messages", "pin", "111", MESSAGE],
      ["messages", "unpin", "111"],
    ]) {
      expect((await runWith(["e-read", ...argv], environment)).code).toBe(5)
    }
    expect(max.sent).toEqual([])
    expect(journalOf("e-read").map(({ kind, outcome }) => `${kind} ${outcome}`)).toEqual([
      "edit refused",
      "forward refused",
      "pin refused",
      "pin refused",
    ])
  })
})
