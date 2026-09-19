import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@cli-heaven/cli-core"
import { describe, expect, it } from "vitest"
import { MaxClient } from "./client.js"
import { Connection } from "./protocol/connection.js"
import { Opcode } from "./protocol/session.js"
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

  return {
    store,
    client: new MaxClient({ store, connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }) }),
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
    expect(client.me()).toEqual({ id: "10000001", name: "Test Person", phone: null })
    expect(client.listChats()).toHaveLength(2)
    expect(client.listChats()[0]?.unreadCount).toBe(2)
    expect(client.listChats()[1]?.unreadCount).toBeNull()
    await client.close()

    expect(max.sent).toHaveLength(2)
  })

  it("**never marks anything read while reading history**", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer, [Opcode.CHAT_HISTORY]: historyAnswer },
    })
    const { client } = clientWith(max)

    await client.connect()
    await client.listMessages("111", 5)
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
    const [message] = await client.listMessages("111")
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
    await expect(client.listMessages("111")).rejects.toMatchObject({ code: "provider_error" })
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
    const sent = await client.sendMessage("111", "hello", { cid: 12345 })
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
    await client.sendMessage("111", "one")
    await client.sendMessage("111", "two")
    await client.close()

    const cids = max.sent
      .filter((call) => call.opcode === Opcode.MSG_SEND)
      .map((call) => (call.payload.message as { cid: number }).cid)
    expect(new Set(cids).size).toBe(2)
  })

  it("**never turns a lost answer into a claim either way**", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    // MSG_SEND has no scripted answer: the request leaves and nothing comes back, which is exactly
    // the case where the message may already have been delivered.
    const failure = await client.sendMessage("111", "hello").catch((error: { code: string }) => error)
    await client.close()

    expect(failure).toMatchObject({ code: "outcome_unknown" })
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
