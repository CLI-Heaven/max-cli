import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@cli-heaven/cli-core"
import { describe, expect, it } from "vitest"
import { MaxClient } from "./client.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const loginAnswer = {
  profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
  chats: [
    { id: 111, title: "First", type: "CHAT", lastEventTime: 1789776000000, newMessages: 2 },
    { id: 222, type: "DIALOG", lastEventTime: 1789776000000 },
  ],
  contacts: [{ id: 10000002, names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
}

const historyAnswer = {
  messages: [{ id: 116762160362694583n, time: 1789776000000, sender: 10000002, text: "hi", attaches: [] }],
}

const clientWith = (max: ReturnType<typeof mockMax>, token = "a-token") => {
  const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
  const keyring = memoryKeyring()
  const store = new SessionStore({ keyring, configDir: dir, stateDir: join(dir, "state"), env: {} })
  if (token) store.writeToken(token)

  const notes: string[] = []

  return {
    store,
    notes,
    client: new MaxClient({
      store,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      warn: (note) => notes.push(note),
    }),
  }
}

describe("MaxClient", () => {
  it("refuses to connect without a session, and names the command that fixes it", async () => {
    const max = mockMax({ answers: {} })
    const { client } = clientWith(max, "")

    await expect(client.connect()).rejects.toMatchObject({ code: "authentication_error" })
    expect(String(await client.connect().catch((error: Error) => error.message))).toContain("max login")
  })

  it("does INIT then LOGIN, in that order, before anything else", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    await client.close()

    expect(max.sent.map((call) => call.opcode)).toEqual([Opcode.SESSION_INIT, Opcode.LOGIN])
  })

  it("tells MAX no human is watching", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    await client.close()

    expect(max.sent[1]?.payload.interactive).toBe(false)
  })

  it("answers `me` and `chats` from the login response, with no further request", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    expect(client.account.me()).toEqual({ id: "10000001", name: "Test Person", phone: null })

    const chats = await client.chats.list()
    expect(chats).toHaveLength(2)
    expect(chats[0]?.unreadCount).toBe(2)
    expect(chats[1]?.unreadCount).toBeNull()
    await client.close()

    expect(max.sent).toHaveLength(2)
  })

  it("names a one-to-one chat after the other person, with one lookup for all of them", async () => {
    const withDialogs = {
      ...loginAnswer,
      chats: [
        { id: 333, type: "DIALOG", participants: { "10000001": 1, "10000003": 1 }, lastEventTime: 1789776000000 },
        { id: 444, type: "DIALOG", participants: { "10000001": 1, "10000004": 1 }, lastEventTime: 1789776000000 },
      ],
    }
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: withDialogs,
        [Opcode.CONTACT_INFO]: {
          contacts: [
            { id: 10000003, names: [{ name: "Ivan Petrov", type: "FULL_NAME" }], link: "ivan" },
            { id: 10000004, names: [{ name: "Maria S", type: "FULL_NAME" }] },
          ],
        },
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    const chats = await client.chats.list()
    await client.close()

    expect(chats.map((chat) => chat.title)).toEqual(["Ivan Petrov", "Maria S"])
    const lookups = max.sent.filter((call) => call.opcode === Opcode.CONTACT_INFO)
    expect(lookups).toHaveLength(1)
    expect(((lookups[0]?.payload.contactIds ?? []) as number[]).sort()).toEqual([10000003, 10000004])
  })

  it("finds a chat by name, and refuses to guess when the name is ambiguous", async () => {
    const withDialogs = {
      ...loginAnswer,
      chats: [
        { id: 333, type: "DIALOG", participants: { "10000001": 1, "10000003": 1 } },
        { id: 555, type: "CHAT", title: "Ivan and friends" },
      ],
    }
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: withDialogs,
        [Opcode.CONTACT_INFO]: { contacts: [{ id: 10000003, names: [{ name: "Ivan Petrov", type: "FULL_NAME" }] }] },
      },
    })
    const { client } = clientWith(max)

    await client.connect()

    expect(await client.chats.resolve("555")).toBe("555")
    expect(await client.chats.resolve("Ivan Petrov")).toBe("333")
    expect(await client.chats.resolve("friends")).toBe("555")
    await expect(client.chats.resolve("Ivan")).rejects.toMatchObject({ code: "validation_error" })
    await expect(client.chats.resolve("nobody")).rejects.toMatchObject({ code: "not_found" })

    await client.close()
  })

  it("lists the people behind one-to-one chats", async () => {
    const withDialogs = {
      ...loginAnswer,
      chats: [{ id: 333, type: "DIALOG", participants: { "10000001": 1, "10000003": 1 } }],
    }
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: withDialogs,
        [Opcode.CONTACT_INFO]: {
          contacts: [
            { id: 10000003, names: [{ name: "Ivan Petrov", type: "FULL_NAME" }], link: "ivan", description: "hi" },
          ],
        },
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    const contacts = await client.contacts.list()
    await client.close()

    expect(contacts).toContainEqual({ id: "10000003", name: "Ivan Petrov", username: "ivan", description: "hi" })
  })

  it("**never marks anything read while reading history**", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer, [Opcode.CHAT_HISTORY]: historyAnswer },
    })
    const { client } = clientWith(max)

    await client.connect()
    await client.messages.list("111", 5)
    await client.close()

    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
    expect(max.sent.at(-1)?.payload.interactive).toBe(false)
  })

  it("names a sender it was told about, and knows which messages are ours", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer, [Opcode.CHAT_HISTORY]: historyAnswer },
    })
    const { client } = clientWith(max)

    await client.connect()
    const [message] = await client.messages.list("111")
    await client.close()

    expect(message?.senderName).toBe("Someone Else")
    expect(message?.outgoing).toBe(false)
    expect(message?.id).toBe("116762160362694583")
  })

  it("turns a refusal from MAX into a code a script can branch on", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer },
      refuse: { [Opcode.CHAT_HISTORY]: "proto.payload" },
    })
    const { client } = clientWith(max)

    await client.connect()
    await expect(client.messages.list("111")).rejects.toMatchObject({ code: "provider_error" })
    await client.close()
  })

  it("treats a refusal naming the token as something `max login` fixes", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {} }, refuse: { [Opcode.LOGIN]: "login.token.invalid" } })
    const { client } = clientWith(max)

    await expect(client.connect()).rejects.toMatchObject({ code: "authentication_error" })
    await client.close()
  })

  it("sends a message with a client id, and reports what came back", async () => {
    const sendAnswer = {
      message: { id: 900000000000000001n, time: 1789776000000, sender: 10000001, text: "hello", attaches: [] },
    }
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer, [Opcode.MSG_SEND]: sendAnswer },
    })
    const { client } = clientWith(max)

    await client.connect()
    const sent = await client.messages.send("111", "hello", { cid: 12345 })
    await client.close()

    const request = max.sent.at(-1)
    expect(request?.opcode).toBe(Opcode.MSG_SEND)
    const message = (request?.payload.message ?? {}) as { cid?: unknown; text?: unknown }
    expect(message.cid).toBe(12345)
    expect(message.text).toBe("hello")
    expect(sent.id).toBe("900000000000000001")
    expect(sent.outgoing).toBe(true)
  })

  it("gives each send its own client id, so two sends are two messages", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_SEND]: { message: { id: 1, time: 1 } },
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    await client.messages.send("111", "one")
    await client.messages.send("111", "two")
    await client.close()

    const cids = max.sent
      .filter((call) => call.opcode === Opcode.MSG_SEND)
      .map((call) => (call.payload.message as { cid: number }).cid)
    expect(new Set(cids).size).toBe(2)
  })

  it("retries a lost send once, with the same client id and never a new one", async () => {
    let attempts = 0
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_SEND]: () => {
          attempts += 1
          // Silent the first time: the request left, nothing came back, and MAX may have kept it.
          return attempts === 1 ? undefined : { message: { id: 7, time: 1789776000000, sender: 10000001, text: "hi" } }
        },
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    const sent = await client.messages.send("111", "hi", { cid: 4242 })
    await client.close()

    const sends = max.sent.filter((call) => call.opcode === Opcode.MSG_SEND)
    expect(sends).toHaveLength(2)
    expect(sends.map((call) => (call.payload.message as { cid: number }).cid)).toEqual([4242, 4242])
    expect(sent.id).toBe("7")
  })

  it("**never turns a lost answer into a claim either way**", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    // MSG_SEND has no scripted answer: the request leaves and nothing comes back, which is exactly
    // the case where the message may already have been delivered.
    const failure = await client.messages.send("111", "hello").catch((error: { code: string }) => error)
    await client.close()

    expect(failure).toMatchObject({ code: "outcome_unknown" })
    expect(String((failure as { message: string }).message)).toContain("--cid")
    expect(max.unexpected).toContain(Opcode.MSG_SEND)
  })

  it("closes the socket, so the process can exit", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    await client.close()

    expect(max.closed).toBe(true)
  })

  it("counts logins, so a token that stops working can be explained", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { store, client } = clientWith(max)

    await client.connect()
    await client.close()

    const state = store.readState()
    expect(state.logins).toBe(1)
    expect(state.viewerId).toBe("10000001")
  })

  it("keeps the same device identity across logins", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { store, client } = clientWith(max)

    const before = store.readState().deviceId
    await client.connect()
    await client.close()

    expect(store.readState().deviceId).toBe(before)
    expect(max.sent[0]?.payload.deviceId).toBe(before)
  })
})

describe("when MAX answers with something we did not declare", () => {
  const SENTINEL = "a private message body"

  it("**says so once, and the command still works**", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.CHAT_HISTORY]: { messages: SENTINEL },
      },
    })
    const { client, notes } = clientWith(max)

    await client.connect()
    const messages = await client.messages.list("111", 5)
    await client.close()

    expect(messages).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain("chats.history")
    expect(notes[0]).toContain("messages")
    expect(notes[0]).toContain("got string")
  })

  it("**never repeats the value it saw**, because the value may be somebody's message", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.CHAT_HISTORY]: { messages: SENTINEL },
      },
    })
    const { client, notes } = clientWith(max)

    await client.connect()
    await client.messages.list("111", 5)
    await client.close()

    expect(notes.join("")).not.toContain(SENTINEL)
  })

  it("stays quiet about a field MAX added and nobody has seen", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.CHAT_HISTORY]: { ...historyAnswer, reactionsSummary: { total: 3 } },
      },
    })
    const { client, notes } = clientWith(max)

    await client.connect()
    await client.messages.list("111", 5)
    await client.close()

    expect(notes).toEqual([])
  })
})

describe("when we are the ones building a bad request", () => {
  it("**refuses before the socket, naming the field and not the message**", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    const failure = await client.messages.send("not-an-id", "a private message body").catch((error: Error) => error)
    await client.close()

    expect(failure).toMatchObject({ code: "validation_error" })
    expect(String(failure)).toContain("messages.send")
    expect(String(failure)).toContain("chatId")
    expect(String(failure)).not.toContain("a private message body")
    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.MSG_SEND)
  })
})
