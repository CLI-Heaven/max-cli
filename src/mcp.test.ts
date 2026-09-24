import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { afterEach, describe, expect, it } from "vitest"
import { contextFor } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { createMaxServer, type ServerOptions } from "./mcp/server.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const scriptedMax = () =>
  mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [
          { id: 111, title: "Team Alpha", type: "CHAT", lastEventTime: 1789776000000 },
          { id: 222, title: "Team Beta", type: "CHAT", lastEventTime: 1789775000000 },
        ],
      },
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

const connect = async (options: Partial<ServerOptions> = {}, { token = true } = {}) => {
  const max = scriptedMax()
  const keyring = memoryKeyring()
  const streams = captureStreams()
  const context = contextFor(
    { profile: `mcp-${++profiles}` },
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
  const server = build()
  await server.connect(serverSide)
  const client = new Client({ name: "test", version: "0" })
  await client.connect(clientSide)
  closers.push(async () => {
    await client.close()
    await server.close()
    await session.close()
  })

  const logins = () => max.sent.filter(({ opcode }) => opcode === Opcode.LOGIN).length
  return { client, session, max, streams, logins }
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

  it("marks the send tool as one a person approves every time", async () => {
    const { client } = await connect({ allowSend: true })
    const { tools } = await client.listTools()
    const send = tools.find(({ name }) => name === "max_messages_send")

    expect(send?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    expect(send?._meta).toMatchObject({ "anthropic/requiresUserInteraction": true })
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
})
