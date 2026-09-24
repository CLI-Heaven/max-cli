import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { Client, type ElicitResult } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { afterEach, describe, expect, it } from "vitest"
import { contextFor } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { createMaxServer, type ServerOptions } from "./mcp/server.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { type MockMaxOptions, mockMax } from "./testing/mock-max.js"

const scriptedMax = (extra: MockMaxOptions["answers"] = {}) =>
  mockMax({
    answers: {
      ...extra,
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: {
          contact: { id: 10000001, phone: 71234567890, names: [{ name: "Test Person", type: "FULL_NAME" }] },
        },
        chats: [
          { id: 111, title: "Team Alpha", type: "CHAT", lastEventTime: 1789776000000 },
          { id: 222, title: "Team Beta", type: "CHAT", lastEventTime: 1789775000000 },
        ],
      },
      [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
      [Opcode.CHAT_HISTORY]: {
        messages: [{ id: 116762160362694583n, time: 1789776000000, sender: 10000001, text: "hi", attaches: [] }],
      },
    },
  })

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

let profiles = 0

const connect = async (
  options: Partial<ServerOptions> = {},
  {
    token = true,
    answers = {},
    profile = `mcp-${++profiles}`,
    form,
    era = "legacy",
  }: {
    token?: boolean
    answers?: MockMaxOptions["answers"]
    profile?: string
    /** Answers the server's form; without it the client says it cannot show one. */
    form?: (message: string) => ElicitResult
    era?: "legacy" | "modern"
  } = {},
) => {
  const max = scriptedMax(answers)
  const keyring = memoryKeyring()
  const streams = captureStreams()
  const context = contextFor(
    { profile },
    {
      streams,
      tty: false,
      store: (profile) => {
        const store = new SessionStore({ profile, keyring })
        if (token) store.writeToken("a-token")
        return store
      },
      connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    },
  )
  const { session, build } = createMaxServer(context, { allowSend: false, ...options })
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  // The modern era is chosen by `serveStdio`, as in `max mcp`; a server connected directly only speaks the legacy one.
  const served = era === "modern" ? serveStdio(build, { transport: serverSide }) : undefined
  const server = served ? undefined : build()
  await server?.connect(serverSide)
  const client = new Client(
    { name: "test", version: "0" },
    {
      ...(form ? { capabilities: { elicitation: {} } } : {}),
      ...(era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}),
    },
  )
  const forms: string[] = []
  if (form) {
    client.setRequestHandler("elicitation/create", async (request) => {
      forms.push(request.params.message)
      return form(request.params.message)
    })
  }
  await client.connect(clientSide)
  closers.push(async () => {
    await client.close()
    await server?.close()
    await served?.close()
    await session.close()
  })

  const logins = () => max.sent.filter(({ opcode }) => opcode === Opcode.LOGIN).length
  return { client, session, max, streams, logins, forms }
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args })
  return { isError: result.isError === true, body: result.structuredContent as Record<string, unknown> }
}

describe("the MCP server", () => {
  it("offers only reading unless it was started with --allow-send", async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()

    expect(tools.map(({ name }) => name)).not.toContain("max_messages_send")
    expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true)
  })

  it("marks every writing tool as one a person approves every time", async () => {
    const { client } = await connect({ allowSend: true })
    const { tools } = await client.listTools()
    const writing = tools.filter(({ annotations }) => annotations?.readOnlyHint === false)

    expect(writing.map(({ name }) => name).sort()).toEqual([
      "max_messages_edit",
      "max_messages_forward",
      "max_messages_pin",
      "max_messages_send",
      "max_messages_unpin",
      "max_polls_create",
      "max_polls_vote",
    ])
    for (const { annotations, _meta } of writing) {
      expect(annotations).toMatchObject({ destructiveHint: true })
      expect(_meta).toMatchObject({ "anthropic/requiresUserInteraction": true })
    }
  })

  it("answers listings in the CLI's envelope, logs in once for several calls, and marks nothing read", async () => {
    const { client, max, streams, logins } = await connect()

    const chats = await call(client, "max_chats_list", { limit: 1 })
    const messages = await call(client, "max_messages_list", { chat: "111" })

    expect(chats.body).toMatchObject({ page: 1, limit: 1, hasMore: true })
    expect((messages.body.items as { id: string }[])[0]?.id).toBe("116762160362694583")
    expect(logins()).toBe(1)
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.CHAT_MARK)
    expect(streams.stdout).toEqual([])
  })

  it("runs calls that arrive together one after another, over the one login", async () => {
    const { client, logins } = await connect()

    const answers = await Promise.all([
      call(client, "max_chats_list"),
      call(client, "max_messages_list", { chat: "111" }),
      call(client, "max_account_show"),
    ])

    expect(answers.map(({ isError }) => isError)).toEqual([false, false, false])
    expect(logins()).toBe(1)
  })

  it("`max_account_show` never hands an agent the whole phone number", async () => {
    const { client } = await connect()

    const { body } = await call(client, "max_account_show")

    expect(body).toMatchObject({ phone: "***7890" })
  })

  it("logs in again once the connection has been idle", async () => {
    const { client, logins } = await connect({ idleMs: 5 })

    await call(client, "max_chats_list")
    await new Promise((resolve) => setTimeout(resolve, 30))
    await call(client, "max_chats_list")

    expect(logins()).toBe(2)
  })

  it("logs in again once the login is older than the age limit, however busy", async () => {
    let now = 0
    const { client, logins } = await connect({ maxAgeMs: 1000, now: () => now })

    await call(client, "max_chats_list")
    now = 999
    await call(client, "max_chats_list")
    now = 1000
    await call(client, "max_chats_list")

    expect(logins()).toBe(2)
  })

  it("refuses a name that matches several chats, with the candidates, and sends nothing", async () => {
    const { client, max } = await connect({ allowSend: true })

    const { isError, body } = await call(client, "max_messages_send", { chat: "Team", text: "hello" })

    expect(isError).toBe(true)
    expect(body.error).toMatchObject({ candidates: [{ id: "111" }, { id: "222" }] })
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.MSG_SEND)
  })

  it("sends to a chat named exactly, and answers the message sent", async () => {
    const { client, max } = await connect(
      { allowSend: true },
      {
        answers: {
          [Opcode.MSG_SEND]: {
            message: { id: 116762160362694590n, time: 1789776000000, sender: 10000001, text: "hello" },
          },
        },
      },
    )

    const { isError, body } = await call(client, "max_messages_send", { chat: "Team Alpha", text: "hello" })

    expect(isError).toBe(false)
    expect(body).toMatchObject({ id: "116762160362694590" })
    expect(max.sent.find(({ opcode }) => opcode === Opcode.MSG_SEND)?.payload).toMatchObject({ chatId: 111 })
  })

  it("hands back the cid when it cannot tell whether a send went out", async () => {
    const { client } = await connect({ allowSend: true }, { answers: { [Opcode.MSG_SEND]: () => undefined } })

    const { isError, body } = await call(client, "max_messages_send", { chat: "111", text: "hello" })

    expect(isError).toBe(true)
    expect(body.error).toMatchObject({ code: "outcome_unknown", cid: expect.any(Number) })
  })

  it("goes through the send guards: a read-only profile refuses, and nothing is sent", async () => {
    const profile = "mcp-read-only"
    await run([profile, "config", "set", "readOnly", "true"], { streams: captureStreams(), tty: false })
    const { client, max } = await connect({ allowSend: true }, { profile })

    const { isError, body } = await call(client, "max_messages_send", { chat: "111", text: "hello" })

    expect(isError).toBe(true)
    expect(body.error).toMatchObject({ code: "permission_error" })
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.MSG_SEND)
  })

  it("offers marking a chat read only with --allow-mark-read, which --allow-send does not imply", async () => {
    const names = async (options: Partial<ServerOptions>) =>
      (await (await connect(options)).client.listTools()).tools.map(({ name }) => name)

    expect(await names({ allowSend: true })).not.toContain("max_chats_read")
    expect(await names({ allowMarkRead: true })).toContain("max_chats_read")
  })

  it("marks a chat read up to the message given, through the send guards", async () => {
    const { client, max } = await connect(
      { allowMarkRead: true },
      { answers: { [Opcode.CHAT_MARK]: { unread: 0, mark: 1789776100000 } } },
    )

    const { isError, body } = await call(client, "max_chats_read", { chat: "111", message: "116762160362694583" })

    expect(isError).toBe(false)
    expect(body).toEqual({ chatId: "111", messageId: "116762160362694583", unread: 0 })
    const marks = max.sent.filter(({ opcode }) => opcode === Opcode.CHAT_MARK)
    expect(marks.map(({ payload }) => String(payload.messageId))).toEqual(["116762160362694583"])
  })

  it("starts without a session and says which command logs in", async () => {
    const { client } = await connect({}, { token: false })

    const { isError, body } = await call(client, "max_account_show")

    expect(isError).toBe(true)
    expect(body.error).toMatchObject({ code: "authentication_error" })
    expect(String((body.error as { message: string }).message)).toMatch(/session start/)
  })

  it("closes the socket to MAX when the session closes", async () => {
    const { client, session, max } = await connect()

    await call(client, "max_chats_list")
    await session.close()

    expect(max.closed).toBe(true)
  })

  describe("with --confirm-send", () => {
    const sendAnswer = {
      [Opcode.MSG_SEND]: { message: { id: 116762160362694590n, time: 1789776000000, sender: 10000001, text: "hello" } },
    }
    const sends = (max: { sent: { opcode: number }[] }) =>
      max.sent.filter(({ opcode }) => opcode === Opcode.MSG_SEND).length

    it.each(["legacy", "modern"] as const)(
      "shows the chat the name resolved to and the text, and sends once confirmed (%s protocol)",
      async (era) => {
        const { client, max, forms } = await connect(
          { allowSend: true, confirmSend: true },
          { answers: sendAnswer, era, form: () => ({ action: "accept", content: {} }) },
        )

        const { isError } = await call(client, "max_messages_send", { chat: "Alpha", text: "hello" })

        expect(isError).toBe(false)
        expect(forms).toEqual(['Send to "Team Alpha" (111)?\n\nhello'])
        expect(sends(max)).toBe(1)
      },
    )

    it.each([
      ["declined", { action: "decline" }],
      ["cancelled", { action: "cancel" }],
    ] as const)("sends nothing when the owner %s", async (_, answer) => {
      const { client, max } = await connect(
        { allowSend: true, confirmSend: true },
        { answers: sendAnswer, form: () => answer as ElicitResult },
      )

      const { isError, body } = await call(client, "max_messages_send", { chat: "111", text: "hello" })

      expect(isError).toBe(true)
      expect(body?.error ?? body).toBeDefined()
      expect(sends(max)).toBe(0)
    })

    it("sends nothing when the client cannot show a form", async () => {
      const { client, max } = await connect({ allowSend: true, confirmSend: true }, { answers: sendAnswer })

      const result = await client.callTool({ name: "max_messages_send", arguments: { chat: "111", text: "hello" } })

      expect(result.isError).toBe(true)
      expect(sends(max)).toBe(0)
    })

    it("sends without a form when the flag is off", async () => {
      const { client, max, forms } = await connect(
        { allowSend: true },
        { answers: sendAnswer, form: () => ({ action: "decline" }) },
      )

      const { isError } = await call(client, "max_messages_send", { chat: "111", text: "hello" })

      expect(isError).toBe(false)
      expect(forms).toEqual([])
      expect(sends(max)).toBe(1)
    })
  })
})
