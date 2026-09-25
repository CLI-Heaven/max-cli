import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@leemour/cli-core"
import { afterEach, describe, expect, it } from "vitest"
import { openCache } from "./cache/open.js"
import { type CacheStore, openStore } from "./cache/store.js"
import { MaxClient } from "./client.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { Connection } from "./protocol/connection.js"
import type { DiagnosticEvent } from "./runs/events.js"
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
  const events: DiagnosticEvent[] = []

  return {
    store,
    notes,
    events,
    client: new MaxClient({
      store,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      warn: (note) => notes.push(note),
      events: (event) => events.push(event),
    }),
  }
}

describe("MaxClient", () => {
  it("refuses to connect without a session, and names the command that fixes it", async () => {
    const max = mockMax({ answers: {} })
    const { client } = clientWith(max, "")

    await expect(client.connect()).rejects.toMatchObject({ code: "authentication_error" })
    expect(String(await client.connect().catch((error: Error) => error.message))).toContain("max session start")
  })

  it("blames the keyring, not the session, when a profile that has logged in finds no token", async () => {
    const max = mockMax({ answers: {} })
    const { client, store } = clientWith(max, "")
    store.writeState({ deviceId: "a-device", logins: 3 })

    const message = String(await client.connect().catch((error: Error) => error.message))
    expect(message).toContain("keyring")
    expect(message).not.toContain("session start")
    await expect(client.connect()).rejects.toMatchObject({ code: "authentication_error" })
  })

  it("leaves no state file behind when a profile nobody logged in under is refused", async () => {
    const max = mockMax({ answers: {} })
    const { client, store } = clientWith(max, "")

    await client.connect().catch(() => undefined)
    expect(store.hasLoggedIn()).toBe(false)
    expect(existsSync(join(store.socketPath(), "..", "default.json"))).toBe(false)
  })

  it("does INIT then LOGIN, in that order, before anything else", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client } = clientWith(max)

    await client.connect()
    await client.close()

    expect(max.sent.map((call) => call.opcode)).toEqual([Opcode.SESSION_INIT, Opcode.LOGIN])
  })

  it("**refuses a token belonging to another account**, and says how to switch on purpose", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = clientWith(max)
    const before = { ...store.readState(), viewerId: "10009999", logins: 4 }
    store.writeState(before)

    const failure = await client.connect().catch((error: Error) => error)
    await client.close()

    expect(failure).toMatchObject({ code: "authentication_error" })
    expect(String(failure)).toContain("session end")

    // A refused login is not a login: counting it would make `RISK-2`'s number a lie, and moving
    // `lastLoginAt` would date the profile by an attempt that never became a session.
    expect(store.readState()).toEqual(before)
  })

  it("remembers the account a profile is for, and lets the same one back in", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = clientWith(max)

    await client.connect()
    await client.close()

    expect(store.readState().viewerId).toBe("10000001")

    const again = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const second = new MaxClient({
      store,
      connection: new Connection({ createSocket: again.createSocket, timeoutMs: 50 }),
      warn: () => {},
    })

    await expect(second.connect()).resolves.toBeUndefined()
    await second.close()
  })

  it("does not refuse a login that names no account, and does not forget the one it knows", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: {} } })
    const { client, store } = clientWith(max)
    store.writeState({ ...store.readState(), viewerId: "10000001" })

    await expect(client.connect()).resolves.toBeUndefined()
    await client.close()

    expect(store.readState().viewerId).toBe("10000001")
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
    expect(await client.account.me()).toEqual({ id: "10000001", name: "Test Person", phone: null, description: null })

    const { items: chats } = await client.chats.list()
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
    const { items: chats } = await client.chats.list()
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
    await expect(client.chats.resolve("Ivan")).rejects.toMatchObject({
      code: "validation_error",
      details: {
        candidates: [
          { id: "333", title: "Ivan Petrov" },
          { id: "555", title: "Ivan and friends" },
        ],
      },
    })
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

    expect(contacts.items).toContainEqual({
      id: "10000003",
      name: "Ivan Petrov",
      username: "ivan",
      description: "hi",
      lastMessagedAt: null,
    })
  })

  it("**never marks anything read while reading history**", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: historyAnswer,
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    await client.messages.list("111", { limit: 5 })
    await client.close()

    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
    expect(max.sent.find((call) => call.opcode === Opcode.CHAT_HISTORY)?.payload.interactive).toBe(false)
  })

  it("sends no telemetry from a one-shot command, as a hidden tab closed within 20 s sends none", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: historyAnswer,
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    await client.messages.list("111", { limit: 5 })
    await client.close()

    expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.LOG)
  })

  describe("reactions", () => {
    const reading = (reactions: Record<number, unknown> = {}) =>
      mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: loginAnswer,
          [Opcode.CHAT_HISTORY]: historyAnswer,
          ...reactions,
        },
        refuse: Opcode.MSG_GET_REACTIONS in reactions ? {} : { [Opcode.MSG_GET_REACTIONS]: "proto.payload" },
      })

    it("**asks once per page** for the messages it read, and puts them on each", async () => {
      const max = reading({
        [Opcode.MSG_GET_REACTIONS]: {
          messagesReactions: {
            "116762160362694583": { totalCount: 3, counters: [{ reaction: "🔥", count: 3 }], yourReaction: "🔥" },
          },
        },
      })
      const { client } = clientWith(max)

      const { items } = await client.messages.list("111", { limit: 5 })
      await client.close()

      expect(items[0]?.reactions).toEqual({ counts: [{ reaction: "🔥", count: 3 }], mine: "🔥", total: 3 })
      const asked = max.sent.filter((call) => call.opcode === Opcode.MSG_GET_REACTIONS)
      expect(asked).toHaveLength(1)
      expect(asked[0]?.payload.messageIds).toEqual([116762160362694583n])
    })

    it("**still reads when reactions cannot be**, and says why", async () => {
      const max = reading()
      const { client, notes } = clientWith(max)

      const { items } = await client.messages.list("111", { limit: 5 })
      await client.close()

      expect(items[0]?.text).toBe("hi")
      expect(items[0]?.reactions).toBeNull()
      expect(notes.join("\n")).toContain("reactions are not shown")
    })
  })

  describe("a window around one message", () => {
    const at = (ms: number, counter: number) => (BigInt(ms) << 16n) | BigInt(counter)
    const target = at(1789776000000, 7)
    const window = {
      messages: [
        { id: at(1789775000000, 1), time: 1789775000000, sender: 10000002, text: "before", attaches: [] },
        { id: target, time: 1789776000000, sender: 10000002, text: "the one", attaches: [] },
        { id: at(1789777000000, 2), time: 1789777000000, sender: 10000002, text: "after", attaches: [] },
      ],
    }

    it("**asks from the message's own time**, one more back for the message itself, and marks it", async () => {
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: loginAnswer,
          [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
          [Opcode.CHAT_HISTORY]: window,
        },
      })
      const { client } = clientWith(max)

      const found = await client.messages.around("111", String(target), { before: 1, after: 1 })
      await client.close()

      const asked = max.sent.find((call) => call.opcode === Opcode.CHAT_HISTORY)?.payload
      expect(asked).toMatchObject({ from: 1789776000000, backward: 2, forward: 1, interactive: false })
      expect(found.map((m) => m.text)).toEqual(["before", "the one", "after"])
      expect(found.filter((m) => m.anchor).map((m) => m.text)).toEqual(["the one"])
      expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
    })

    it("**refuses a message that is gone** rather than passing a neighbour off as it", async () => {
      const neighbours = { messages: window.messages.filter((m) => m.id !== target) }
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: loginAnswer,
          [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
          [Opcode.CHAT_HISTORY]: neighbours,
        },
      })
      const { client } = clientWith(max)

      await expect(client.messages.around("111", String(target))).rejects.toMatchObject({ code: "not_found" })
      await client.close()
    })

    it("refuses what is not a message id before asking MAX anything", async () => {
      const max = mockMax({ answers: {} })
      const { client } = clientWith(max)

      await expect(client.messages.around("111", "hello")).rejects.toMatchObject({ code: "validation_error" })
      expect(max.sent).toEqual([])
      await client.close()
    })
  })

  it("names a sender it was told about, and knows which messages are ours", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: historyAnswer,
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    const [message] = (await client.messages.list("111")).items
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

  it("treats a refusal naming the token as something `max session start` fixes", async () => {
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

  it("**notifies by default and stays silent only when asked**", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_SEND]: { message: { id: 1, time: 1 } },
      },
    })
    const { client } = clientWith(max)

    await client.connect()
    await client.messages.send("111", "loud")
    await client.messages.send("111", "quiet", { notify: false })
    await client.close()

    const sends = max.sent.filter((call) => call.opcode === Opcode.MSG_SEND)
    expect(sends.map((call) => call.payload.notify)).toEqual([true, false])
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
    // MSG_SEND is answered with silence: the request leaves and nothing comes back, which is
    // exactly the case where the message may already have been delivered.
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer, [Opcode.MSG_SEND]: () => undefined },
    })
    const { client } = clientWith(max)

    await client.connect()
    const failure = await client.messages.send("111", "hello").catch((error: Error) => error)
    await client.close()

    expect(failure).toMatchObject({ code: "outcome_unknown" })
    expect(String(failure)).toContain("--cid")
    expect(max.sent.map((call) => call.opcode)).toContain(Opcode.MSG_SEND)
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
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: { messages: SENTINEL },
      },
    })
    const { client, notes } = clientWith(max)

    await client.connect()
    const messages = await client.messages.list("111", { limit: 5 })
    await client.close()

    expect(messages.items).toEqual([])
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
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: { messages: SENTINEL },
      },
    })
    const { client, notes } = clientWith(max)

    await client.connect()
    await client.messages.list("111", { limit: 5 })
    await client.close()

    expect(notes.join("")).not.toContain(SENTINEL)
  })

  it("stays quiet about a field MAX added and nobody has seen", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: { ...historyAnswer, reactionsSummary: { total: 3 } },
      },
    })
    const { client, notes } = clientWith(max)

    await client.connect()
    await client.messages.list("111", { limit: 5 })
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

describe("the token MAX answers with", () => {
  it("**is kept when MAX offers a different one**, which is what we used to drop", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { ...loginAnswer, token: "the-rotated-one" } },
    })
    const { client, store } = clientWith(max)

    await client.connect()
    await client.close()

    expect(store.readToken()).toBe("the-rotated-one")
  })

  it("is left alone when MAX sends the same one back, or none at all", async () => {
    const same = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { ...loginAnswer, token: "a-token" } },
    })
    const first = clientWith(same)
    await first.client.connect()
    await first.client.close()
    expect(first.store.readToken()).toBe("a-token")

    const none = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const second = clientWith(none)
    await second.client.connect()
    await second.client.close()
    expect(second.store.readToken()).toBe("a-token")
  })

  it("**is not written for an account this profile is not set up with**", async () => {
    const first = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = clientWith(first)
    await client.connect()
    await client.close()

    // A different `viewerId` — somebody else's token, which `connect` refuses. It must not have
    // replaced the owner's working credential on the way to that refusal.
    const stranger = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: {
          profile: { contact: { id: 99999999, names: [{ name: "Somebody Else", type: "FULL_NAME" }] } },
          token: "a-stranger-token",
        },
      },
    })
    const second = new MaxClient({
      store,
      connection: new Connection({ createSocket: stranger.createSocket, timeoutMs: 50 }),
      warn: () => {},
    })

    await expect(second.connect()).rejects.toMatchObject({ code: "authentication_error" })
    await second.close()
    expect(store.readToken()).toBe("a-token")
  })

  it("**never fails the command when the keyring will not take it**, and says why", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { ...loginAnswer, token: "the-rotated-one" } },
    })
    const { client, store, notes } = clientWith(max)
    store.writeToken = () => {
      throw new Error("the keyring is locked")
    }

    await client.connect()
    await client.close()

    expect(notes.join(" ")).toContain("could not be saved")
    expect(notes.join(" ")).not.toContain("the-rotated-one")
  })

  it("keeps the value out of every diagnostic", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { ...loginAnswer, token: "the-rotated-one" } },
    })
    const { client, events } = clientWith(max)

    await client.connect()
    await client.close()

    expect(JSON.stringify(events)).not.toContain("the-rotated-one")
  })
})

describe("with a cache", () => {
  const caches: CacheStore[] = []
  afterEach(() => {
    for (const cache of caches.splice(0)) cache.close()
  })

  const cacheStore = async () => {
    const database = await openCache(join(mkdtempSync(join(tmpdir(), "max-client-cache-")), "cache.db"))
    const cache = openStore({ database })
    caches.push(cache)
    return cache
  }

  const clientSharing = (cache: CacheStore, max: ReturnType<typeof mockMax>) => {
    const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
    const store = new SessionStore({ keyring: memoryKeyring(), configDir: dir, stateDir: join(dir, "state"), env: {} })
    store.writeToken("a-token")
    return new MaxClient({
      store,
      cache,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    })
  }

  describe("naming the senders of a group chat", () => {
    const group = {
      messages: [
        { id: 116762160362694583n, time: 1789776000000, sender: 10000009, text: "hi", attaches: [] },
        {
          id: 116762160362694590n,
          time: 1789776000100,
          sender: 10000008,
          text: "re",
          attaches: [],
          link: { type: "REPLY", chatId: 1, message: { id: 1, sender: 10000009, text: "hi", time: 1789776000000 } },
        },
      ],
    }
    const info = {
      contacts: [
        { id: 10000009, names: [{ name: "Михаил", type: "FULL_NAME" }] },
        { id: 10000008, names: [{ name: "Стас", type: "FULL_NAME" }] },
      ],
    }

    it("**asks once for the names of members who are not contacts**, and keeps them", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: loginAnswer,
          [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
          [Opcode.CHAT_HISTORY]: group,
          [Opcode.CONTACT_INFO]: info,
        },
      })
      const client = clientSharing(cache, max)
      const { items } = await client.messages.list("111", { limit: 5 })
      await client.close()

      expect(items.map((m) => m.senderName)).toEqual(["Михаил", "Стас"])
      expect(items[1]?.replyTo?.senderName).toBe("Михаил")
      const asked = max.sent.filter((call) => call.opcode === Opcode.CONTACT_INFO)
      expect(asked.at(-1)?.payload.contactIds).toEqual(expect.arrayContaining([10000009, 10000008]))

      const again = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: loginAnswer,
          [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
          [Opcode.CHAT_HISTORY]: group,
        },
      })
      const second = clientSharing(cache, again)
      expect((await second.messages.list("111", { limit: 5 })).items.map((m) => m.senderName)).toEqual([
        "Михаил",
        "Стас",
      ])
      await second.close()
      expect(again.sent.map((call) => call.opcode)).not.toContain(Opcode.CONTACT_INFO)
    })

    it("**still answers when the names cannot be looked up**, showing ids and saying why", async () => {
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: loginAnswer,
          [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
          [Opcode.CHAT_HISTORY]: group,
        },
        refuse: { [Opcode.CONTACT_INFO]: "proto.payload" },
      })
      const { client, notes } = clientWith(max)
      const { items } = await client.messages.list("111", { limit: 5 })
      await client.close()

      expect(items.map((m) => m.senderName)).toEqual([null, null])
      expect(notes.join("\n")).toContain("shown by id")
    })
  })

  it("**answers from the record without opening a connection**, when offline is asked for", async () => {
    const cache = await cacheStore()

    const first = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const warm = clientSharing(cache, first)
    expect((await warm.chats.list()).items).toHaveLength(2)
    await warm.close()
    expect(first.sent.map((call) => call.opcode)).toEqual([Opcode.SESSION_INIT, Opcode.LOGIN])

    // A socket that throws if anyone reaches for it: the cache must answer without the wire.
    const store = new SessionStore({
      keyring: memoryKeyring(),
      configDir: mkdtempSync(join(tmpdir(), "max-cli-")),
      env: {},
    })
    store.writeToken("a-token")
    const offline = new MaxClient({
      store,
      cache,
      offline: true,
      connection: new Connection({
        createSocket: () => {
          throw new Error("the cache should have answered this without a connection")
        },
      }),
    })

    expect((await offline.chats.list()).items).toHaveLength(2)
    await offline.close()
  })

  it('**asks MAX every time by default**, because a record is not an answer to "what is new?"', async () => {
    const cache = await cacheStore()
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const client = clientSharing(cache, max)

    await client.chats.list()
    await client.close()
    expect(max.sent.map((call) => call.opcode)).toContain(Opcode.LOGIN)

    // Recorded a moment ago, and it still connects: the login carries fresh chats anyway.
    const again = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const second = clientSharing(cache, again)
    await second.chats.list()
    await second.close()
    expect(again.sent.map((call) => call.opcode)).toContain(Opcode.LOGIN)
  })

  it("**offline, `before` and `after` read the record either side of the moment**, not its newest page", async () => {
    const cache = await cacheStore()
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 0, minute)).toISOString()
    cache.messages.write(
      "111",
      [1, 2, 3, 4].map((minute) => ({
        id: String(minute),
        chatId: "111",
        senderId: "7",
        senderName: null,
        timestamp: at(minute),
        editedAt: null,
        text: "",
        outgoing: false,
        attachments: [],
        replyTo: null,
        forwardedFrom: null,
        reactions: null,
      })),
    )
    const max = mockMax({ answers: {} })
    const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
    const offline = new MaxClient({
      store: new SessionStore({ keyring: memoryKeyring(), configDir: dir, env: {} }),
      cache,
      offline: true,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    })

    const ids = async (options: { before?: number; after?: number }) =>
      (await offline.messages.list("111", { limit: 2, ...options })).items.map((message) => message.id)

    expect(await ids({ before: Date.parse(at(3)) })).toEqual(["2", "3"])
    expect(await ids({ after: Date.parse(at(1)) })).toEqual(["2", "3"])
    expect(max.sent).toEqual([])
  })

  it("says what to do when offline has nothing recorded", async () => {
    const cache = await cacheStore()
    const max = mockMax({ answers: {} })
    const store = new SessionStore({
      keyring: memoryKeyring(),
      configDir: mkdtempSync(join(tmpdir(), "max-cli-")),
      env: {},
    })
    store.writeToken("a-token")
    const client = new MaxClient({
      store,
      cache,
      offline: true,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    })

    const failure = await client.chats.list().catch((error: Error) => error)
    expect(String(failure)).toContain("--offline")
    expect(max.sent).toEqual([])
  })

  describe("the delta sync", () => {
    /** A login that answers with a `time`, which is the marker to send back next run. */
    const syncing = (over: Record<string, unknown> = {}) => ({ ...loginAnswer, time: 1_789_776_000_000, ...over })

    const markerOf = (max: ReturnType<typeof mockMax>) => max.sent.find((call) => call.opcode === Opcode.LOGIN)?.payload

    it("**sends `0` until there is a marker, then sends the one it stored**", async () => {
      const cache = await cacheStore()

      const first = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: syncing() } })
      const client = clientSharing(cache, first)
      await client.chats.list()
      await client.close()
      expect(markerOf(first)?.contactsSync).toBe(0)

      const second = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: syncing() } })
      const again = clientSharing(cache, second)
      await again.chats.list()
      await again.close()

      // Only contacts: MAX refused the time in all four over the binary protocol (`FIND-162`).
      expect(markerOf(second)).toMatchObject({
        chatsSync: 0,
        contactsSync: 1_789_776_000_000,
        presenceSync: 0,
        draftsSync: 0,
      })
    })

    it("**keeps what an earlier login brought when a later one carries nothing**", async () => {
      const cache = await cacheStore()

      const full = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: syncing() } })
      const client = clientSharing(cache, full)
      await client.chats.list()
      await client.close()

      // The second login is a delta: MAX has nothing new to say, which is not the same as saying
      // there is nothing. A store that replaced instead of merging would empty itself here.
      const empty = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: { profile: loginAnswer.profile, chats: [], contacts: [], time: 1_789_776_000_001 },
        },
      })
      const second = clientSharing(cache, empty)
      await second.chats.list()
      await second.close()

      expect(cache.people.page({ order: "name", limit: 20, offset: 0 })).toHaveLength(1)
      expect(cache.chats.read(Number.POSITIVE_INFINITY)).toHaveLength(2)
    })

    it("**stores everyone in a group, and none of them as a contact**", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          // The third person is in a group of three and nowhere else. Before this, `#partnerOf`
          // gave up on any chat with more than one other person and never asked who they were.
          [Opcode.CONTACT_INFO]: {
            contacts: [{ id: 10000003, names: [{ name: "Group Only", type: "FULL_NAME" }] }],
          },
          [Opcode.LOGIN]: syncing({
            chats: [
              { id: 111, title: "A group", type: "CHAT", participants: { 10000001: 1, 10000002: 1, 10000003: 1 } },
              { id: 222, type: "DIALOG", participants: { 10000001: 1, 10000002: 1 } },
            ],
          }),
        },
      })

      const client = clientSharing(cache, max)
      await client.chats.list()
      await client.close()

      // 10000001 is us and is never a member of anything; the other two are.
      expect(cache.people.chatsWith("10000002").sort()).toEqual(["111", "222"])
      expect(cache.people.chatsWith("10000003")).toEqual(["111"])

      const everyone = cache.people.page({ order: "name", limit: 20, offset: 0 })
      expect(everyone.map((p) => p.name)).toContain("Group Only")
      expect(cache.people.contacts({ order: "recent", limit: 20, offset: 0 }).map((p) => p.id)).toEqual(["10000002"])
    })

    it("asks for the ids the login left unnamed **in one request, not one per chat**", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing({
            chats: [
              { id: 111, type: "CHAT", participants: { 10000001: 1, 20: 1, 21: 1 } },
              { id: 222, type: "CHAT", participants: { 10000001: 1, 22: 1, 23: 1 } },
              { id: 333, type: "DIALOG", participants: { 10000001: 1, 24: 1 } },
            ],
          }),
        },
      })

      const client = clientSharing(cache, max)
      await client.chats.list()
      await client.close()

      const asked = max.sent.filter((call) => call.opcode === Opcode.CONTACT_INFO)
      expect(asked).toHaveLength(1)
      // Ids go onto the wire as numbers, the way MAX sends them; they are strings everywhere above.
      expect(asked[0]?.payload.contactIds).toEqual([20, 21, 22, 23, 24])
    })

    it("**does not store a channel's members**, because what it lists is not its membership", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing({
            chats: [
              { id: 333, title: "A channel", type: "CHANNEL", participantsCount: 178011, participants: { 9: 1 } },
            ],
          }),
        },
      })

      const client = clientSharing(cache, max)
      await client.chats.list()
      await client.close()

      expect(cache.people.chatsWith("9")).toEqual([])
    })

    it("**answers from the store, not from the delta**, which after the first login is empty", async () => {
      const cache = await cacheStore()

      const full = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing({ chats: [{ id: 222, type: "DIALOG", participants: { 10000001: 1, 10000002: 1 } }] }),
        },
      })
      const client = clientSharing(cache, full)
      expect((await client.contacts.list()).items).toHaveLength(1)
      await client.close()

      const empty = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.LOGIN]: { profile: loginAnswer.profile, chats: [], contacts: [], time: 1_789_776_000_001 },
        },
      })
      const second = clientSharing(cache, empty)
      const again = await second.contacts.list()
      await second.close()

      expect(again.items.map((person) => person.id)).toEqual(["10000002"])
    })

    it("pages contacts in SQL and says whether another page exists", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing({
            chats: [
              { id: 1, type: "DIALOG", lastEventTime: 300, participants: { 10000001: 1, 31: 1 } },
              { id: 2, type: "DIALOG", lastEventTime: 200, participants: { 10000001: 1, 32: 1 } },
              { id: 3, type: "DIALOG", lastEventTime: 100, participants: { 10000001: 1, 33: 1 } },
            ],
            contacts: [{ id: 31 }, { id: 32 }, { id: 33 }],
          }),
        },
      })

      const client = clientSharing(cache, max)
      const first = await client.contacts.list({ limit: 2 })
      const second = await client.contacts.list({ limit: 2, offset: 2 })
      await client.close()

      expect(first.items.map((person) => person.id)).toEqual(["31", "32"])
      expect(first.hasMore).toBe(true)
      expect(second.items.map((person) => person.id)).toEqual(["33"])
      expect(second.hasMore).toBe(false)
    })

    it("**`contacts sync` forgets the marker**, so the login it makes asks for everything", async () => {
      const cache = await cacheStore()

      const first = mockMax({
        answers: { [Opcode.SESSION_INIT]: {}, [Opcode.CONTACT_INFO]: { contacts: [] }, [Opcode.LOGIN]: syncing() },
      })
      const warm = clientSharing(cache, first)
      await warm.chats.list()
      await warm.close()
      expect(cache.syncMarker()).toBe(1_789_776_000_000)

      const max = mockMax({
        answers: { [Opcode.SESSION_INIT]: {}, [Opcode.CONTACT_INFO]: { contacts: [] }, [Opcode.LOGIN]: syncing() },
      })
      const client = clientSharing(cache, max)
      const summary = await client.contacts.sync()
      await client.close()

      expect(max.sent.find((call) => call.opcode === Opcode.LOGIN)?.payload.contactsSync).toBe(0)
      expect(summary).toMatchObject({ full: true, known: 1 })
    })

    it("names nobody in the sync summary", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: { [Opcode.SESSION_INIT]: {}, [Opcode.CONTACT_INFO]: { contacts: [] }, [Opcode.LOGIN]: syncing() },
      })
      const client = clientSharing(cache, max)
      const summary = await client.contacts.sync()
      await client.close()

      expect(JSON.stringify(summary)).not.toContain("Someone Else")
      expect(Object.keys(summary).sort()).toEqual(["added", "changed", "full", "known"])
    })

    it("**`--before` reads the time out of a message id**, with no stored copy needed", async () => {
      const client = clientSharing(await cacheStore(), mockMax({ answers: {} }))

      expect(client.messages.moment("116762160362694583")).toBe(Number(116762160362694583n >> 16n))
      expect(client.messages.moment("2026-09-20T01:00:00Z")).toBe(Date.parse("2026-09-20T01:00:00Z"))
      expect(() => client.messages.moment("next tuesday")).toThrow(/ISO 8601/)
      await client.close()
    })

    it("anchors the history request at what `--before` resolved to", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing(),
          [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
          [Opcode.CHAT_HISTORY]: historyAnswer,
        },
      })

      const client = clientSharing(cache, max)
      await client.messages.list("111", { limit: 5, before: 1_700_000_000_000 })
      await client.close()

      expect(max.sent.find((call) => call.opcode === Opcode.CHAT_HISTORY)?.payload.from).toBe(1_700_000_000_000)
    })

    it("**keeps a chat's members when a later delta re-sends that chat without them**", async () => {
      const cache = await cacheStore()
      const withMembers = { id: 222, type: "DIALOG", lastEventTime: 100, participants: { 10000001: 1, 10000002: 1 } }

      const first = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing({ chats: [withMembers] }),
        },
      })
      const client = clientSharing(cache, first)
      expect((await client.contacts.list()).items).toHaveLength(1)
      await client.close()

      // MAX re-sends the chat because a message arrived, and says nothing about who is in it.
      // "Did not say" is not "nobody": clearing the edge here loses the contact entirely.
      const quiet = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.LOGIN]: syncing({
            chats: [{ id: 222, type: "DIALOG", lastEventTime: 200, newMessages: 1 }],
            time: 1_789_776_000_001,
          }),
        },
      })
      const second = clientSharing(cache, quiet)
      const again = await second.contacts.list()
      await second.close()

      expect(again.items.map((person) => person.id)).toEqual(["10000002"])
      expect(cache.people.chatsWith("10000002")).toEqual(["222"])
    })

    it("**`--offline` answers the contacts it recorded**, not everyone it can name", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          [Opcode.CONTACT_INFO]: { contacts: [{ id: 10000003, names: [{ name: "Group Only", type: "FULL_NAME" }] }] },
          [Opcode.LOGIN]: syncing({
            chats: [
              { id: 222, type: "DIALOG", lastEventTime: 100, participants: { 10000001: 1, 10000002: 1 } },
              { id: 111, type: "CHAT", participants: { 10000001: 1, 10000003: 1, 10000002: 1 } },
            ],
          }),
        },
      })
      const client = clientSharing(cache, max)
      await client.contacts.list()
      await client.close()

      const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
      const store = new SessionStore({
        keyring: memoryKeyring(),
        configDir: dir,
        stateDir: join(dir, "state"),
        env: {},
      })
      store.writeToken("a-token")
      const offline = new MaxClient({
        store,
        cache,
        offline: true,
        connection: new Connection({
          createSocket: () => {
            throw new Error("`--offline` must answer without a connection")
          },
        }),
      })

      const recorded = await offline.contacts.list()
      await offline.close()

      // The group-only person is in the store and is not a contact, offline exactly as online.
      expect(recorded.items.map((person) => person.id)).toEqual(["10000002"])
    })

    it("says what to do when `--offline` has no contacts recorded", async () => {
      const cache = await cacheStore()
      const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
      const store = new SessionStore({
        keyring: memoryKeyring(),
        configDir: dir,
        stateDir: join(dir, "state"),
        env: {},
      })
      store.writeToken("a-token")
      const offline = new MaxClient({ store, cache, offline: true })

      const failure = await offline.contacts.list().catch((error: Error) => error)
      expect(String(failure)).toContain("--offline")
    })

    it("**orders by recency the people the login never named**", async () => {
      const cache = await cacheStore()
      const max = mockMax({
        answers: {
          [Opcode.SESSION_INIT]: {},
          // Nobody in `contacts`, everybody in the chat: the real proportion is 6 named out of 22.
          [Opcode.CONTACT_INFO]: { contacts: [{ id: 40, names: [{ name: "Named Later", type: "FULL_NAME" }] }] },
          [Opcode.LOGIN]: syncing({
            contacts: [],
            chats: [{ id: 1, type: "DIALOG", lastEventTime: 500, participants: { 10000001: 1, 40: 1 } }],
          }),
        },
      })

      const client = clientSharing(cache, max)
      const page = await client.contacts.list()
      await client.close()

      expect(page.items).toHaveLength(1)
      expect(page.items[0]?.lastMessagedAt).toBe(new Date(500).toISOString())
    })

    it("**does not advance the marker when the merge fails, and does not fail the command**", async () => {
      const cache = await cacheStore()
      const notes: string[] = []
      const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: syncing() } })

      const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
      const store = new SessionStore({
        keyring: memoryKeyring(),
        configDir: dir,
        stateDir: join(dir, "state"),
        env: {},
      })
      store.writeToken("a-token")
      const client = new MaxClient({
        store,
        cache: {
          ...cache,
          mergeDelta: () => {
            throw new Error("the disk is full")
          },
        },
        warn: (note) => notes.push(note),
        connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      })

      expect((await client.chats.list()).items).toHaveLength(2)
      await client.close()

      expect(cache.syncMarker()).toBeUndefined()
      expect(notes.join(" ")).toContain("did not take this login")
    })

    it("names nobody in the note it writes when the merge fails", async () => {
      const cache = await cacheStore()
      const notes: string[] = []
      const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: syncing() } })

      const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
      const store = new SessionStore({
        keyring: memoryKeyring(),
        configDir: dir,
        stateDir: join(dir, "state"),
        env: {},
      })
      store.writeToken("a-token")
      const client = new MaxClient({
        store,
        cache: {
          ...cache,
          mergeDelta: () => {
            throw new Error("Someone Else could not be written")
          },
        },
        warn: (note) => notes.push(note),
        connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      })

      await client.chats.list()
      await client.close()

      expect(notes.join(" ")).not.toContain("Someone Else")
    })
  })

  it("**stops trusting a chat it has just sent to**", async () => {
    const cache = await cacheStore()
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: historyAnswer,
        [Opcode.MSG_SEND]: { message: { id: 9, time: 1789776000001, text: "sent" } },
      },
    })
    const client = clientSharing(cache, max)

    await client.messages.list("111", { limit: 5 })
    expect(cache.messages.read("111", 5, 60_000), "cached after the first read").toBeDefined()

    await client.messages.send("111", "hello")
    expect(cache.messages.read("111", 5, 60_000), "forgotten after the send").toBeUndefined()

    await client.close()
  })
})

const PRIVATE = "a private message body"
const RECEIVED = "what somebody else said"

describe("one event per request", () => {
  it("**puts the login on the record too** — it is what most invocations spend their time on", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, events } = clientWith(max)

    await client.connect()
    await client.close()

    // `max chats list` answers out of the LOGIN response and sends nothing of its own, so a hook
    // that saw only the later requests would report an empty run for a command that logged in.
    expect(events.map((event) => `${event.event} ${event.operation}`)).toEqual([
      "request session.init",
      "response session.init",
      "request session.login",
      "response session.login",
    ])
  })

  it("carries the opcode, the seq and what the round trip cost", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: historyAnswer,
      },
    })
    const { client, events } = clientWith(max)

    await client.connect()
    await client.messages.list("111", { limit: 5 })
    await client.close()

    const asked = events.find((event) => event.event === "request" && event.operation === "chats.history")
    const answered = events.find((event) => event.event === "response" && event.operation === "chats.history")

    expect(asked).toMatchObject({ opcode: Opcode.CHAT_HISTORY, seq: 2, ids: { chat: "111" } })
    expect(answered).toMatchObject({ opcode: Opcode.CHAT_HISTORY, seq: 2, outcome: "ok", counts: { messages: 1 } })
    expect(answered && "bytes" in answered && answered.bytes).toBeGreaterThan(0)
  })

  it("**never carries a title, a name, a message or the token**", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: loginAnswer,
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: {
          messages: [{ id: 116762160362694583n, time: 1, sender: 10000002, text: RECEIVED, attaches: [] }],
        },
        [Opcode.MSG_SEND]: { message: { id: 900000000000000001n, time: 1, sender: 10000001, text: PRIVATE } },
      },
    })
    const { client, events } = clientWith(max, "a-secret-token")

    await client.connect()
    await client.messages.list("111", { limit: 5 })
    await client.messages.send("111", PRIVATE, { cid: 4242 })
    await client.close()

    const recorded = JSON.stringify(events)
    for (const secret of [PRIVATE, RECEIVED, "a-secret-token", "Test Person", "Someone Else", "First"]) {
      expect(recorded).not.toContain(secret)
    }
    // And the one identifier that is allowed, so this cannot pass by recording nothing at all.
    expect(recorded).toContain('"cid":"4242"')
  })

  it("records the request that never came back, with the code and not the reason", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer },
      refuse: { [Opcode.CHAT_HISTORY]: "proto.payload" },
    })
    const { client, events } = clientWith(max)

    await client.connect()
    await expect(client.messages.list("111")).rejects.toMatchObject({ code: "provider_error" })
    await client.close()

    expect(events.at(-1)).toMatchObject({
      event: "response",
      operation: "chats.history",
      outcome: "error",
      errorCode: "provider_error",
    })
  })

  it("keeps working when whoever is listening throws", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
    const store = new SessionStore({ keyring: memoryKeyring(), configDir: dir, stateDir: join(dir, "state"), env: {} })
    store.writeToken("a-token")

    const client = new MaxClient({
      store,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      events: () => {
        throw new Error("the log is broken")
      },
    })

    await client.connect()
    expect((await client.account.me()).id).toBe("10000001")
    await client.close()
  })
})
