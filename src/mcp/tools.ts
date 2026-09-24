import { CliError, isCliError } from "@leemour/cli-core"
import {
  type CallToolResult,
  isInputRequiredResult,
  type McpServer,
  type ServerContext,
  type ToolAnnotations,
} from "@modelcontextprotocol/server"
import { toStandardJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"
import type { MaxClient } from "../client.js"
import { maskedProfile } from "../domain/map.js"
import type { Page } from "../domain/models.js"
import { confirmer, type SendArgs } from "./confirm.js"
import type { MaxSession } from "./session.js"

const chat = v.pipe(v.string(), v.minLength(1), v.description("chat id, or part of a chat name"))
const message = v.pipe(v.string(), v.regex(/^\d+$/), v.description("message id"))
const limit = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100), v.description("how many")))
const page = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.description("which page, from 1")))

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
}
const APPROVE = { "anthropic/requiresUserInteraction": true }

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
    // Always masked: an agent has no reason to hold the owner's number (`NEED-209`).
    answer: async (client) => maskedProfile(await client.account.me()),
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
      message,
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
 * Registered only with `--allow-send`, so a server started without it has no way to write at all —
 * not a refusal at call time, an absence from the list.
 *
 * `requiresUserInteraction` is Claude Code's: an approval dialog on every call that allow-rules do
 * not skip. Other clients ask by `destructiveHint` or `readOnlyHint`.
 */
const SEND_TOOLS = {
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
    annotations: WRITE,
    _meta: APPROVE,
    answer: async (client, args) => {
      const chatId = await client.chats.resolve(args.chat)
      return client.messages.send(chatId, args.text, {
        ...(args.cid === undefined ? {} : { cid: args.cid }),
        ...(args.silent === true ? { notify: false } : {}),
      })
    },
  }),
  max_messages_edit: tool({
    title: "Edit a message",
    description:
      "Replace the text of one of the owner's own messages. Only when the owner asked for this exact change. " +
      "The other person may have read the old text already. Attachments stay.",
    input: v.object({ chat, message, text: v.pipe(v.string(), v.minLength(1)) }),
    annotations: WRITE,
    _meta: APPROVE,
    answer: async (client, args) =>
      client.messages.edit(await client.chats.resolve(args.chat), args.message, args.text),
  }),
  max_messages_forward: tool({
    title: "Forward a message",
    description:
      "Forward one message to another chat as the owner. Only when the owner asked for this message to this chat. " +
      "On outcome_unknown, retry with the cid it returns and MAX drops the duplicate.",
    input: v.object({
      chat: v.pipe(chat, v.description("the chat the message is in")),
      message,
      to: v.pipe(chat, v.description("the chat to forward it to")),
      cid: v.optional(v.pipe(v.number(), v.integer(), v.description("from an earlier outcome_unknown"))),
    }),
    annotations: WRITE,
    _meta: APPROVE,
    answer: async (client, args) =>
      client.messages.forward(
        await client.chats.resolve(args.chat),
        args.message,
        await client.chats.resolve(args.to),
        args.cid === undefined ? {} : { cid: args.cid },
      ),
  }),
  max_messages_pin: tool({
    title: "Pin a message",
    description: "Pin one message in a chat, replacing what was pinned. Members are not notified.",
    input: v.object({ chat, message }),
    annotations: WRITE,
    _meta: APPROVE,
    answer: async (client, args) => client.messages.pin(await client.chats.resolve(args.chat), args.message),
  }),
  max_messages_unpin: tool({
    title: "Unpin a message",
    description: "Unpin whatever message is pinned in a chat.",
    input: v.object({ chat }),
    annotations: WRITE,
    _meta: APPROVE,
    answer: async (client, args) => client.messages.pin(await client.chats.resolve(args.chat), null),
  }),
}

/** Registered only with `--allow-mark-read`: the other person sees it, and `--allow-send` does not imply it. */
const MARK_READ_TOOLS = {
  max_chats_read: tool({
    title: "Mark a chat read",
    description:
      "Mark a chat read up to a message, or up to its newest message. The other person sees that it was read. Only when the owner asked for it.",
    input: v.object({ chat, message: v.optional(message) }),
    annotations: WRITE,
    _meta: APPROVE,
    answer: async (client, args) => client.chats.markRead(await client.chats.resolve(args.chat), args.message),
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
  {
    allowSend,
    confirmSend = false,
    allowMarkRead = false,
    defaultLimit,
  }: { allowSend: boolean; confirmSend?: boolean; allowMarkRead?: boolean; defaultLimit: number },
): void => {
  const confirmed = confirmSend ? confirmer() : undefined

  const tools: Record<string, AnyTool> = {
    ...READ_TOOLS,
    ...(allowSend ? SEND_TOOLS : {}),
    ...(allowMarkRead ? MARK_READ_TOOLS : {}),
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
      async (args: Record<string, unknown>, ctx: ServerContext) => {
        try {
          const result = await session.use(name.replace(/^max_/, "mcp ").replaceAll("_", " "), (client) =>
            confirmed && name === "max_messages_send"
              ? confirmed(client, args as unknown as SendArgs, ctx)
              : definition.answer(client, args, { limit: defaultLimit }),
          )
          return isInputRequiredResult(result) ? result : answered(result)
        } catch (error) {
          return failed(error)
        }
      },
    )
  }
}
