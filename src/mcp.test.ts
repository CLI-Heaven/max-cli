import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { Client, type ElicitResult } from "@modelcontextprotocol/client"
import { InMemoryTransport } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { afterEach, describe, expect, it, vi } from "vitest"
import { contextFor } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { instructions } from "./mcp/instructions.js"
import { createMaxServer, type ServerOptions } from "./mcp/server.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { type MockMaxOptions, mockMax } from "./testing/mock-max.js"

const scriptedMax = (extra: MockMaxOptions["answers"] = {}) =>
  mockMax({
    answers: {
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
      ...extra,
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
      "max_reactions_add",
      "max_reactions_remove",
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

  it("schedules with `at` the way `--at` does, and answers scheduledFor", async () => {
    const { client, max } = await connect(
      { allowSend: true },
      {
        answers: {
          [Opcode.MSG_SEND]: (request) => ({
            message: {
              id: 117328171499542309n,
              time: 1789776000000,
              sender: 10000001,
              text: "later",
              ...(request.message as object),
            },
          }),
        },
      },
    )

    const { isError, body } = await call(client, "max_messages_send", { chat: "111", text: "later", at: "2h" })

    expect(isError).toBe(false)
    const sent = max.sent.find(({ opcode }) => opcode === Opcode.MSG_SEND)?.payload as {
      message: { delayedAttributes: { timeToFire: number } }
      notify: boolean
    }
    expect(sent.notify).toBe(true)
    expect(sent.message.delayedAttributes.timeToFire % 60_000).toBe(0)
    expect(body.scheduledFor).toBe(new Date(sent.message.delayedAttributes.timeToFire).toISOString())
  })

  it("refuses an `at` that `--at` refuses, before sending anything", async () => {
    const { client, max } = await connect({ allowSend: true })

    for (const args of [{ at: "30s" }, { at: "1h", silent: true }, { at: "1h", cid: 5 }]) {
      const { isError, body } = await call(client, "max_messages_send", { chat: "111", text: "x", ...args })
      expect(isError).toBe(true)
      expect(body.error).toMatchObject({ code: "validation_error" })
    }
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.MSG_SEND)
  })

  it("reads the queue of scheduled messages without --allow-send", async () => {
    const { client, max } = await connect()

    const { isError } = await call(client, "max_messages_scheduled", { chat: "111" })

    expect(isError).toBe(false)
    expect(max.sent.find(({ opcode }) => opcode === Opcode.CHAT_HISTORY)?.payload).toMatchObject({
      itemType: "DELAYED",
    })
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

  it("does not offer a tool the profile's allow list leaves out, whatever the flags", async () => {
    const profile = "mcp-allow"
    await run([profile, "config", "set", "allow", "send,pin"], { streams: captureStreams(), tty: false })
    const { client } = await connect({ allowSend: true, allowDelete: true, allowMarkRead: true }, { profile })

    const names = (await client.listTools()).tools.map(({ name }) => name)

    expect(names).toEqual(expect.arrayContaining(["max_messages_send", "max_messages_pin", "max_messages_unpin"]))
    expect(names).not.toContain("max_messages_edit")
    expect(names).not.toContain("max_messages_forward")
    expect(names).not.toContain("max_messages_delete")
    expect(names).not.toContain("max_chats_read")
    expect(names).toContain("max_messages_list")
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

  it("offers deleting only with --allow-delete, which --allow-send does not imply, and only for the owner", async () => {
    const names = async (options: Partial<ServerOptions>) =>
      (await (await connect(options)).client.listTools()).tools.map(({ name }) => name)
    expect(await names({ allowSend: true, allowMarkRead: true })).not.toContain("max_messages_delete")

    const { client, max } = await connect({ allowDelete: true }, { answers: { [Opcode.MSG_DELETE]: {} } })
    const { isError } = await call(client, "max_messages_delete", {
      chat: "111",
      messages: ["116762160362694583"],
      forEveryone: true,
    })

    expect(isError).toBe(false)
    const deletes = max.sent.filter(({ opcode }) => opcode === Opcode.MSG_DELETE)
    expect(deletes.map(({ payload }) => payload.forMe)).toEqual([true])
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
        expect(forms).toEqual(['Send a message?\n\nchat: "Team Alpha" (111)\n\nhello'])
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

    it("shows when a scheduled message will go, and schedules it once confirmed", async () => {
      const { client, max, forms } = await connect(
        { allowSend: true, confirmSend: true },
        { answers: sendAnswer, form: () => ({ action: "accept", content: {} }) },
      )

      const { isError } = await call(client, "max_messages_send", { chat: "111", text: "hello", at: "2h" })

      expect(isError).toBe(false)
      const payload = max.sent.find(({ opcode }) => opcode === Opcode.MSG_SEND)?.payload as
        | { message: { delayedAttributes: { timeToFire: number } } }
        | undefined
      const fire = payload?.message.delayedAttributes.timeToFire ?? 0
      expect(forms).toEqual([
        `Send a message?\n\nchat: "Team Alpha" (111)\nat: ${new Date(fire).toISOString()}\n\nhello`,
      ])
    })

    it("asks before a forward too, and forwards nothing on a no", async () => {
      const { client, max, forms } = await connect(
        { allowSend: true, confirmSend: true },
        { answers: sendAnswer, form: () => ({ action: "decline" }) },
      )

      const { isError } = await call(client, "max_messages_forward", {
        chat: "111",
        message: "116762160362694590",
        to: "Alpha",
      })

      expect(isError).toBe(true)
      expect(forms).toEqual([
        'Forward a message?\n\nchat: "Team Alpha" (111)\nto: "Team Alpha" (111)\nmessage: "116762160362694590"',
      ])
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

describe("what the MCP server offers beyond the basics", () => {
  const PHOTO_URL = "https://93.184.215.14/photo-secret-token.webp"
  const webp = (size: number) => {
    const bytes = new Uint8Array(size)
    bytes.set(new TextEncoder().encode("RIFF"), 0)
    bytes.set(new TextEncoder().encode("WEBP"), 8)
    return bytes
  }
  const withPhoto = {
    [Opcode.CONTACT_INFO]: { contacts: [] },
    [Opcode.CHAT_HISTORY]: {
      messages: [
        {
          id: 116762160362694583n,
          time: 1789776000000,
          sender: 20000002,
          text: "look",
          attaches: [
            { _type: "FILE", fileId: 5, name: "a.pdf" },
            { _type: "PHOTO", baseUrl: PHOTO_URL, width: 900, height: 593 },
          ],
        },
      ],
    },
  }
  const serving = (body: Uint8Array | Error) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (body instanceof Error) throw body
        return new Response(body, { headers: { "content-length": String(body.length) } })
      }),
    )
  afterEach(() => vi.unstubAllGlobals())

  it("`max_inbox` answers the unread messages of every chat in one call and leaves the saved point alone", async () => {
    const profile = "mcp-inbox"
    const { client } = await connect(
      {},
      {
        profile,
        answers: {
          [Opcode.LOGIN]: {
            profile: { contact: { id: 10000001 } },
            chats: [
              { id: 111, title: "Team Alpha", type: "CHAT", lastEventTime: 1789776000000, newMessages: 1 },
              { id: 222, title: "Team Beta", type: "CHAT", lastEventTime: 1789775000000, newMessages: 1 },
            ],
          },
          [Opcode.CONTACT_INFO]: { contacts: [] },
          [Opcode.CHAT_HISTORY]: (request) => ({
            messages: [
              { id: 116762160362694583n, time: 1789775000000, sender: 20000002, text: `in ${request.chatId}` },
            ],
          }),
        },
      },
    )

    const store = new SessionStore({ profile, keyring: memoryKeyring() })
    store.writeState({ ...store.readState(), lastCheckAt: "2026-09-20T10:00:00.000Z" })

    const unread = await call(client, "max_inbox")
    const since = await call(client, "max_inbox", { since: "2026-09-01T00:00:00Z" })

    expect(unread.isError).toBe(false)
    expect((unread.body.chats as { id: string }[]).map(({ id }) => id)).toEqual(["111", "222"])
    expect(since.body).toMatchObject({ mode: "new" })
    expect(store.readState().lastCheckAt).toBe("2026-09-20T10:00:00.000Z")
  })

  it("a reply carries the REPLY link and Markdown goes out as markup", async () => {
    const { client, max } = await connect(
      { allowSend: true },
      {
        answers: {
          [Opcode.MSG_SEND]: {
            message: { id: 116762160362694590n, time: 1789776000000, sender: 10000001, text: "yes" },
          },
        },
      },
    )

    const { isError } = await call(client, "max_messages_send", {
      chat: "111",
      text: "**yes**",
      reply_to: "116762160362694583",
      markdown: true,
    })

    expect(isError).toBe(false)
    const { message } = (max.sent.find(({ opcode }) => opcode === Opcode.MSG_SEND)?.payload ?? {}) as {
      message: { text: string; link: { type: string; messageId: unknown }; elements: unknown[] }
    }
    expect(message.link.type).toBe("REPLY")
    expect(String(message.link.messageId)).toBe("116762160362694583")
    expect(message).toMatchObject({ text: "yes", elements: [{ type: "STRONG", from: 0, length: 3 }] })
  })

  it("shows the reply in the confirmation form, so a yes is bound to it", async () => {
    const { client, forms } = await connect(
      { allowSend: true, confirmSend: true },
      { form: () => ({ action: "decline" }) },
    )

    await call(client, "max_messages_send", { chat: "111", text: "yes", reply_to: "116762160362694583" })

    expect(forms[0]).toContain('reply_to: "116762160362694583"')
  })

  it("offers reactions with --allow-send, and not on a profile whose allow list lacks them", async () => {
    await run(["mcp-no-reactions", "config", "set", "allow", "send"], { streams: captureStreams(), tty: false })
    const names = async (profile?: string) =>
      (await (await connect({ allowSend: true }, profile ? { profile } : {})).client.listTools()).tools.map(
        ({ name }) => name,
      )

    expect(await names()).toEqual(expect.arrayContaining(["max_reactions_add", "max_reactions_remove"]))
    expect(await names("mcp-no-reactions")).not.toContain("max_reactions_add")
  })

  it("puts a reaction on a message", async () => {
    const { client, max } = await connect(
      { allowSend: true },
      {
        answers: {
          [Opcode.MSG_REACTION]: {
            reactionInfo: { counters: [{ count: 1, reaction: "👍" }], yourReaction: "👍", totalCount: 1 },
          },
        },
      },
    )

    const { isError, body } = await call(client, "max_reactions_add", {
      chat: "111",
      message: "116762160362694583",
      emoji: "👍",
    })

    expect(isError).toBe(false)
    expect(body).toEqual({ counts: [{ reaction: "👍", count: 1 }], mine: "👍", total: 1 })
    expect(max.sent.find(({ opcode }) => opcode === Opcode.MSG_REACTION)?.payload).toMatchObject({
      reaction: { reactionType: "EMOJI", id: "👍" },
    })
  })

  it("hands a photo over as an image, and never its link", async () => {
    serving(webp(81_164))
    const { client } = await connect({}, { answers: withPhoto })

    const result = await client.callTool({
      name: "max_messages_photo",
      arguments: { chat: "111", message: "116762160362694583" },
    })

    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([
      { type: "image", mimeType: "image/webp", data: Buffer.from(webp(81_164)).toString("base64") },
      {
        type: "text",
        text: JSON.stringify({ chatId: "111", messageId: "116762160362694583", index: 1, bytes: 81_164 }),
      },
    ])
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  it.each([
    ["a photo over the cap", () => serving(webp(600 * 1024)), {}],
    ["a download that fails", () => serving(new TypeError("fetch failed")), {}],
    ["a file", () => serving(webp(16)), { index: 0 }],
    ["a message with a file and no photo", () => serving(webp(16)), {}, "no photo"],
  ])("refuses %s, naming the command that saves it", async (_, serve, extra, variant?: string) => {
    serve()
    const history = withPhoto[Opcode.CHAT_HISTORY].messages[0]
    const { client } = await connect(
      {},
      {
        answers:
          variant === "no photo"
            ? {
                ...withPhoto,
                [Opcode.CHAT_HISTORY]: { messages: [{ ...history, attaches: history?.attaches.slice(0, 1) }] },
              }
            : withPhoto,
      },
    )

    const result = await client.callTool({
      name: "max_messages_photo",
      arguments: { chat: "111", message: "116762160362694583", ...extra },
    })

    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain("max messages download 111 116762160362694583")
    expect(JSON.stringify(result)).not.toContain("secret-token")
  })

  it("asks the owner before a reaction, and reacts with nothing on a no", async () => {
    const { client, max, forms } = await connect(
      { allowSend: true, confirmSend: true },
      { form: () => ({ action: "decline" }) },
    )

    const { isError } = await call(client, "max_reactions_add", {
      chat: "111",
      message: "116762160362694583",
      emoji: "👍",
    })

    expect(isError).toBe(true)
    expect(forms[0]).toContain('emoji: "👍"')
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.MSG_REACTION)
  })

  it("keeps its instructions within the 2048 characters a client shows, with every flag on", () => {
    const text = instructions({
      allowSend: true,
      confirmSend: true,
      allowMarkRead: true,
      allowDelete: true,
      profile: "a-profile-name-of-some-length",
      permitted: ["send", "forward", "reaction", "edit", "pin", "read", "delete"],
    })

    expect(text.length).toBeLessThanOrEqual(2048)
  })
})

describe("MCP prompts and resources", () => {
  it("lists three prompts with their arguments, and builds one without asking MAX for anything", async () => {
    const { client, max } = await connect()

    const { prompts } = await client.listPrompts()
    const reply = await client.getPrompt({ name: "reply", arguments: { chat: "Team Alpha" } })

    expect(
      prompts.map(({ name, arguments: args }) => [name, args?.map(({ name, required }) => [name, required])]),
    ).toEqual([
      ["catch-up", [["since", false]]],
      ["reply", [["chat", true]]],
      ["find", [["text", true]]],
    ])
    expect(reply.messages).toHaveLength(1)
    expect(JSON.stringify(reply)).toContain('\\"Team Alpha\\"')
    expect(max.sent).toEqual([])
  })

  it("lists chats from the local copy without logging in, and reads one over a single login", async () => {
    const { client, logins } = await connect()

    const before = await client.listResources()
    await call(client, "max_chats_list")
    const after = await client.listResources()
    const read = await client.readResource({ uri: "max://chat/111" })

    expect(before.resources).toEqual([])
    expect(after.resources.map(({ uri, name }) => [uri, name])).toEqual([
      ["max://chat/111", "Team Alpha"],
      ["max://chat/222", "Team Beta"],
    ])
    const body = JSON.parse(String((read.contents[0] as { text: string }).text))
    expect(body).toMatchObject({ chat: { id: "111", title: "Team Alpha" }, messages: [{ id: "116762160362694583" }] })
    expect(logins()).toBe(1)
  })
})
