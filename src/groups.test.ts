import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import type { Payload } from "./protocol/frame.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const GROUP = {
  id: -70000000000001,
  title: "Team",
  type: "CHAT",
  access: "PRIVATE",
  link: "https://max.ru/join/abcdef",
  participantsCount: 2,
  options: { ALL_CAN_PIN_MESSAGE: true, ONLY_ADMIN_CAN_ADD_MEMBER: false, OFFICIAL: false },
}

const messenger = (answers: Record<number, Payload | ((request: Payload) => Payload | undefined)> = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001 } },
        chats: [GROUP, { id: 222, title: "Strangers", type: "CHAT" }],
      },
      [Opcode.MSG_SEND]: { chat: GROUP, chatId: GROUP.id, message: { id: 1n, time: 1789776000000 } },
      [Opcode.CHAT_JOIN]: { chat: GROUP },
      [Opcode.LINK_INFO]: { chat: GROUP },
      [Opcode.CHAT_LEAVE]: { message: {} },
      [Opcode.CHAT_UPDATE]: { chat: GROUP },
      [Opcode.CHAT_MEMBERS_UPDATE]: { chat: GROUP },
      [Opcode.CHAT_MEMBERS]: {
        members: [{ contact: { id: 30000003, names: [{ name: "Asker", type: "FULL_NAME" }] } }],
      },
      ...answers,
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
  const sent = (opcode: number) => max.sent.filter((request) => request.opcode === opcode).map((call) => call.payload)
  return { max, environment, sent }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const journalOf = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

describe("joining and leaving", () => {
  it("joins by the `join/` part of the link, as measured, and answers the group", async () => {
    const { environment, sent } = messenger()
    const joined = await runWith(["gr-join", "chats", "join", "https://max.ru/join/abcdef", "--json"], environment)

    expect(joined.code).toBe(0)
    expect(sent(Opcode.CHAT_JOIN)).toEqual([{ link: "join/abcdef" }])
    expect(JSON.parse(joined.stdout)).toMatchObject({
      id: "-70000000000001",
      title: "Team",
      kind: "group",
      access: "private",
      settings: { allCanPin: true, onlyAdminsAdd: false, onlyAdminsCall: null },
    })
    expect(journalOf("gr-join")).toMatchObject([
      { chatId: "-70000000000001", kind: "chat", action: "join", outcome: "sent" },
    ])
  })

  it("refuses what is not a MAX link before anything is sent", async () => {
    const { environment, max } = messenger()
    const refused = await runWith(["gr-bad-link", "chats", "join", "Team"], environment)

    expect(refused.code).toBe(2)
    expect(max.sent).toEqual([])
  })

  it("`inspect` reads a link and joins nothing", async () => {
    const { environment, sent } = messenger()
    const read = await runWith(["gr-inspect", "chats", "inspect", "max.ru/join/abcdef", "--json"], environment)

    expect(read.code).toBe(0)
    expect(sent(Opcode.LINK_INFO)).toEqual([{ link: "join/abcdef" }])
    expect(sent(Opcode.CHAT_JOIN)).toEqual([])
    expect(journalOf("gr-inspect")).toEqual([])
  })

  it("leaves a chat named by its title", async () => {
    const { environment, sent } = messenger()
    expect((await runWith(["gr-leave", "chats", "leave", "Team"], environment)).code).toBe(0)
    expect(sent(Opcode.CHAT_LEAVE).map((payload) => String(payload.chatId))).toEqual(["-70000000000001"])
  })
})

describe("creating a group", () => {
  it("sends one CONTROL message with the title and the people, and counts it as a send", async () => {
    const { environment, sent } = messenger()
    await runWith(["gr-create", "config", "set", "sendsPerHour", "1"])
    const created = await runWith(["gr-create", "chats", "create", "Team", "20000002", "--json"], environment)

    expect(created.code).toBe(0)
    const [request] = sent(Opcode.MSG_SEND) as { message: { attaches: Payload[] } }[]
    expect(request?.message.attaches).toEqual([
      { _type: "CONTROL", event: "new", chatType: "CHAT", title: "Team", userIds: [20000002] },
    ])
    expect(journalOf("gr-create")).toMatchObject([{ kind: "chat", action: "create", outcome: "sent", people: 1 }])

    const second = await runWith(["gr-create", "chats", "create", "Again"], environment)
    expect(second.code).toBe(8)
    expect(sent(Opcode.MSG_SEND)).toHaveLength(1)
  })

  it("is never retried: an unanswered creation is sent once", async () => {
    const { environment, sent } = messenger({ [Opcode.MSG_SEND]: () => undefined })
    const created = await runWith(["gr-create-once", "chats", "create", "Team"], environment)

    expect(created.code).not.toBe(0)
    expect(sent(Opcode.MSG_SEND)).toHaveLength(1)
  })
})

describe("changing a group", () => {
  it("is refused on a read-only profile before anything reaches MAX, and journalled", async () => {
    const { environment, sent } = messenger()
    await runWith(["gr-ro", "config", "set", "readOnly", "true"])
    const refused = await runWith(["gr-ro", "chats", "join", "https://max.ru/join/abcdef"], environment)

    expect(refused.code).toBe(5)
    expect(sent(Opcode.CHAT_JOIN)).toEqual([])
    expect(journalOf("gr-ro")).toMatchObject([
      { chatId: null, kind: "chat", action: "join", outcome: "refused", errorCode: "permission_error" },
    ])
  })

  it("with a recipient list, changes only the chats on it", async () => {
    const { environment, sent } = messenger()
    await runWith(["gr-list", "recipients", "add", "-70000000000001"], environment)

    expect((await runWith(["gr-list", "chats", "members", "add", "222", "20000002"], environment)).code).toBe(7)
    expect(sent(Opcode.CHAT_MEMBERS_UPDATE)).toEqual([])
    expect((await runWith(["gr-list", "chats", "members", "add", "Team", "20000002"], environment)).code).toBe(0)
    expect(sent(Opcode.CHAT_MEMBERS_UPDATE)).toHaveLength(1)
  })

  it("adds with history unless asked not to, and removes without erasing anyone's messages", async () => {
    const { environment, sent } = messenger()
    await runWith(["gr-members", "chats", "members", "add", "Team", "20000002", "--hide-history"], environment)
    await runWith(["gr-members", "chats", "members", "remove", "Team", "20000002"], environment)

    expect(sent(Opcode.CHAT_MEMBERS_UPDATE)).toMatchObject([
      { userIds: [20000002], operation: "add", showHistory: false },
      { userIds: [20000002], operation: "remove", cleanMsgPeriod: 0 },
    ])
  })

  it("makes an admin with the rights summed as MAX takes them, and refuses a right it does not know", async () => {
    const { environment, sent } = messenger()
    const made = await runWith(
      ["gr-admin", "chats", "admins", "add", "Team", "20000002", "--can", "members,pin"],
      environment,
    )
    const typo = await runWith(["gr-admin", "chats", "admins", "add", "Team", "20000002", "--can", "fly"], environment)

    expect(made.code).toBe(0)
    expect(typo.code).toBe(2)
    expect(sent(Opcode.CHAT_MEMBERS_UPDATE)).toEqual([
      { chatId: -70000000000001, userIds: [20000002], operation: "add", type: "ADMIN", permissions: 18 },
    ])
  })

  it("takes admin rights back with the measured shape, which no other client had", async () => {
    const { environment, sent } = messenger()
    expect((await runWith(["gr-unadmin", "chats", "admins", "remove", "Team", "20000002"], environment)).code).toBe(0)
    expect(sent(Opcode.CHAT_MEMBERS_UPDATE)).toEqual([
      { chatId: -70000000000001, userIds: [20000002], operation: "remove", type: "ADMIN" },
    ])
  })

  it("renames through `theme`, MAX's name for the title", async () => {
    const { environment, sent } = messenger()
    expect((await runWith(["gr-update", "chats", "update", "Team", "--title", "Crew"], environment)).code).toBe(0)
    expect((await runWith(["gr-update", "chats", "update", "Team"], environment)).code).toBe(2)
    expect(sent(Opcode.CHAT_UPDATE)).toEqual([{ chatId: -70000000000001, theme: "Crew" }])
  })

  it("`settings` reads without sending, and changes only the flags given", async () => {
    const { environment, sent } = messenger()
    const read = await runWith(["gr-settings", "chats", "settings", "Team", "--json"], environment)
    expect(JSON.parse(read.stdout).settings).toMatchObject({ allCanPin: true, onlyAdminsAdd: false })
    expect(sent(Opcode.CHAT_UPDATE)).toEqual([])

    await runWith(["gr-settings", "chats", "settings", "Team", "--all-can-pin", "off"], environment)
    expect(sent(Opcode.CHAT_UPDATE)).toEqual([{ chatId: -70000000000001, options: { ALL_CAN_PIN_MESSAGE: false } }])
    expect(
      (await runWith(["gr-settings", "chats", "settings", "Team", "--all-can-pin", "yes"], environment)).code,
    ).toBe(2)
  })

  it("replaces the invite link", async () => {
    const { environment, sent } = messenger()
    expect((await runWith(["gr-link", "chats", "link", "reset", "Team"], environment)).code).toBe(0)
    expect(sent(Opcode.CHAT_UPDATE)).toEqual([{ chatId: -70000000000001, revokePrivateLink: true }])
  })

  it("lists join requests as people, and accepts one", async () => {
    const { environment, sent } = messenger()
    const listed = await runWith(["gr-requests", "chats", "requests", "list", "Team", "--json"], environment)
    await runWith(["gr-requests", "chats", "requests", "accept", "Team", "30000003"], environment)

    expect(JSON.parse(listed.stdout)).toMatchObject([{ id: "30000003", name: "Asker" }])
    expect(sent(Opcode.CHAT_MEMBERS_UPDATE)).toMatchObject([
      { userIds: [30000003], type: "JOIN_REQUEST", operation: "add", showHistory: true },
    ])
    expect(journalOf("gr-requests")).toMatchObject([{ action: "requests.accept", people: 1 }])
  })
})
