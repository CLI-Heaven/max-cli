import { CliError, isCliError } from "@leemour/cli-core"
import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { toStandardJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"
import type { MaxClient } from "../client.js"
import type { Page } from "../domain/models.js"
import type { MaxSession } from "./session.js"

const chat = v.pipe(v.string(), v.minLength(1), v.description("chat id, or part of a chat name"))
const limit = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100), v.description("how many")))
const page = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.description("which page, from 1")))

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true }

interface Tool<S extends v.ObjectSchema<v.ObjectEntries, undefined>> {
  title: string
  description: string
  input: S
  annotations: ToolAnnotations
  _meta?: Record<string, unknown>
  answer: (client: MaxClient, args: v.InferOutput<S>, defaults: { limit: number }) => Promise<object>
}

type AnyTool = Omit<Tool<v.ObjectSchema<v.ObjectEntries, undefined>>, "answer"> & {
  answer: (client: MaxClient, args: Record<string, unknown>, defaults: { limit: number }) => Promise<object>
}

/** Typed where it is written; erased here because the SDK checks the arguments against `input` first. */
const tool = <S extends v.ObjectSchema<v.ObjectEntries, undefined>>(definition: Tool<S>): AnyTool =>
  definition as unknown as AnyTool

/** The same envelope `--json` prints for every listing. */
const envelope = <T>({ items, hasMore }: Page<T>, pageNumber: number, pageSize: number) => ({
  items,
  page: pageNumber,
  limit: pageSize,
  hasMore,
})

const window = (args: { limit?: number; page?: number }, defaults: { limit: number }) => {
  const size = args.limit ?? defaults.limit
  const number = args.page ?? 1
  return { size, number, request: { limit: size, offset: (number - 1) * size } }
}

const READ_TOOLS = {
  max_account_show: tool({
    title: "Who this is",
    description: "The MAX account this server is logged in as.",
    input: v.object({}),
    annotations: { ...READ, idempotentHint: true },
    answer: (client) => client.account.me(),
  }),

  max_chats_list: tool({
    title: "List chats",
    description:
      "Chats the owner is in, most recent first. Use it to find a chat's id before reading or sending. " +
      "Returns { items, page, limit, hasMore }.",
    input: v.object({
      search: v.optional(v.pipe(v.string(), v.minLength(3), v.description("only chats whose name contains this"))),
      kind: v.optional(v.picklist(["dialog", "group", "channel"])),
      unread: v.optional(v.pipe(v.boolean(), v.description("only chats with unread messages"))),
      limit,
      page,
    }),
    annotations: READ,
    answer: async (client, { search: query, kind, unread, ...paging }, defaults) => {
      const { size, number, request } = window(paging, defaults)
      const found = await client.chats.list({
        ...request,
        ...(query === undefined ? {} : { query }),
        ...(kind === undefined ? {} : { kind }),
        ...(unread === true ? { unread } : {}),
      })
      return envelope(found, number, size)
    },
  }),

  max_chats_show: tool({
    title: "Show a chat",
    description: "One chat: its kind, unread count, last message time and who is in it.",
    input: v.object({ chat }),
    annotations: READ,
    answer: (client, args) => client.chats.show(args.chat),
  }),

  max_contacts_list: tool({
    title: "List contacts",
    description: "People the owner has a one-to-one chat with. Returns { items, page, limit, hasMore }.",
    input: v.object({
      search: v.optional(v.pipe(v.string(), v.minLength(3), v.description("only people whose name contains this"))),
      order: v.optional(v.picklist(["recent", "name"])),
      limit,
      page,
    }),
    annotations: READ,
    answer: async (client, { search: query, order, ...paging }, defaults) => {
      const { size, number, request } = window(paging, defaults)
      const found = await client.contacts.list({
        ...request,
        ...(query === undefined ? {} : { query }),
        ...(order === undefined ? {} : { order }),
      })
      return envelope(found, number, size)
    },
  }),

  max_contacts_show: tool({
    title: "Show a person",
    description: "One person and the chats shared with them.",
    input: v.object({
      person: v.pipe(v.string(), v.minLength(1), v.description("person id, @username, or part of a name")),
    }),
    annotations: READ,
    answer: (client, args) => client.contacts.show(args.person),
  }),

  max_messages_list: tool({
    title: "Read a chat",
    description:
      "Recent messages in a chat, oldest first. Does not mark anything read. For older messages pass " +
      "`before` = the id of the first item; for newer, `after` = the id of the last. Returns { items, page, limit, hasMore }.",
    input: v.object({
      chat,
      limit,
      before: v.optional(v.pipe(v.string(), v.description("a message id or an ISO 8601 time"))),
      after: v.optional(v.pipe(v.string(), v.description("a message id or an ISO 8601 time; not with before"))),
    }),
    annotations: READ,
    answer: async (client, args, defaults) => {
      if (args.before !== undefined && args.after !== undefined) {
        throw new CliError("validation_error", "before and after are two directions; give one of them")
      }
      const size = args.limit ?? defaults.limit
      const chatId = await client.chats.resolve(args.chat)
      const anchor =
        args.after !== undefined
          ? { after: client.messages.moment(args.after, "after") }
          : args.before !== undefined
            ? { before: client.messages.moment(args.before, "before") }
            : {}
      return envelope(await client.messages.list(chatId, { limit: size, ...anchor }), 1, size)
    },
  }),

  max_messages_search: tool({
    title: "Search messages",
    description:
      "Find messages in what this machine has already read — it never asks MAX, so an empty answer means " +
      '"not in what was read", not "never said". Returns { items, page, limit, hasMore }.',
    input: v.object({
      text: v.pipe(v.string(), v.minLength(3), v.description("what to look for; at least 3 characters")),
      chat: v.optional(v.pipe(v.string(), v.regex(/^-?\d+$/), v.description("only this chat, by id"))),
      limit,
    }),
    annotations: { ...READ, openWorldHint: false },
    answer: async (client, args, defaults) => {
      const size = args.limit ?? defaults.limit
      const found = await client.messages.search(args.text, {
        limit: size,
        ...(args.chat === undefined ? {} : { chatId: args.chat }),
      })
      return envelope(found, 1, size)
    },
  }),

  max_messages_context: tool({
    title: "Show a message",
    description:
      "One message by id, and optionally the messages either side of it, oldest first. The one asked for " +
      "carries anchor: true.",
    input: v.object({
      chat,
      message: v.pipe(v.string(), v.regex(/^\d+$/), v.description("message id")),
      before: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))),
      after: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100))),
    }),
    annotations: READ,
    answer: async (client, args) => {
      const chatId = await client.chats.resolve(args.chat)
      return {
        items: await client.messages.around(chatId, args.message, { before: args.before ?? 0, after: args.after ?? 0 }),
      }
    },
  }),
}

/**
 * Registered only with `--allow-send`, so a server started without it has no way to send at all —
 * not a refusal at call time, an absence from the list.
 *
 * `requiresUserInteraction` is Claude Code's: an approval dialog on every call that allow-rules do
 * not skip. Other clients ask by `destructiveHint` or `readOnlyHint`.
 */
const SEND_TOOL = {
  max_messages_send: tool({
    title: "Send a message",
    description:
      "Send one text message as the owner. Only when the owner asked for this exact text to this exact chat. " +
      "A name that matches several chats is refused with the candidates — pick an id, never guess. " +
      "On outcome_unknown, retry with the cid it returns and MAX drops the duplicate.",
    input: v.object({
      chat,
      text: v.pipe(v.string(), v.minLength(1)),
      silent: v.optional(v.pipe(v.boolean(), v.description("deliver without a notification"))),
      cid: v.optional(v.pipe(v.number(), v.integer(), v.description("from an earlier outcome_unknown"))),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { "anthropic/requiresUserInteraction": true },
    answer: async (client, args) => {
      const chatId = await client.chats.resolve(args.chat)
      return client.messages.send(chatId, args.text, {
        ...(args.cid === undefined ? {} : { cid: args.cid }),
        ...(args.silent === true ? { notify: false } : {}),
      })
    },
  }),
}

const answered = (value: object): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
})

/** The same object the CLI prints on stderr, so an agent reads one error shape from both. */
const failed = (error: unknown): CallToolResult => {
  const body = isCliError(error)
    ? { code: error.code, message: error.message, ...error.details }
    : { code: "generic_failure", message: error instanceof Error ? error.message : String(error) }
  return {
    content: [{ type: "text", text: JSON.stringify({ error: body }) }],
    structuredContent: { error: body },
    isError: true,
  }
}

export const registerTools = (
  server: McpServer,
  session: MaxSession,
  { allowSend, defaultLimit }: { allowSend: boolean; defaultLimit: number },
): void => {
  const tools: Record<string, AnyTool> = {
    ...READ_TOOLS,
    ...(allowSend ? SEND_TOOL : {}),
  }

  for (const [name, definition] of Object.entries(tools)) {
    server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: toStandardJsonSchema(definition.input),
        annotations: definition.annotations,
        ...(definition._meta ? { _meta: definition._meta } : {}),
      },
      async (args: Record<string, unknown>) => {
        try {
          return answered(
            await session.use(name.replace(/^max_/, "mcp ").replaceAll("_", " "), (client) =>
              definition.answer(client, args, { limit: defaultLimit }),
            ),
          )
        } catch (error) {
          return failed(error)
        }
      },
    )
  }
}
