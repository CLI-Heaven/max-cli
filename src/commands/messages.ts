import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { Id, Message, WindowedMessage } from "../domain/models.js"
import { type Saved, save } from "../download.js"
import { renderMessages } from "../rendering/messages.js"
import { readBody } from "./body.js"
import { type CommandContext, forCommand } from "./context.js"
import { renderPage } from "./paging.js"

export const messagesCommand = (): Command => {
  const command = new Command("messages").description("read and send messages in a chat")

  /**
   * Observational, and deliberately so: this reads `CHAT_HISTORY` and never sends `CHAT_MARK`, so
   * looking at a conversation does not tell anyone you read it (REQUIREMENTS §19).
   */
  command
    .command("list")
    .argument("<chat>", "chat id, or part of a chat name")
    .description("recent messages in a chat, oldest first")
    .option("--limit <n>", "how many to read", (value) => Number.parseInt(value, 10))
    // Not `--page`: this history is anchored in time, so paging backwards through it is exact
    // rather than approximate. A message id is what the reader has in front of them, having just
    // read the output; an ISO 8601 time is what still works once that message is gone.
    .option("--before <id-or-time>", "read what came before this message id, or this ISO 8601 time")
    .option("--after <id-or-time>", "read what came after this message id, or this ISO 8601 time; not with --before")
    .action(async function (this: Command, chat: string) {
      const options = this.optsWithGlobals()
      if (options.before !== undefined && options.after !== undefined) {
        throw new CliError("validation_error", "--before and --after are two directions; give one of them")
      }

      const context = forCommand(this)
      const { renderer, settings, createClient, run } = context
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("messages list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const anchor =
            options.after !== undefined
              ? { after: client.messages.moment(String(options.after), "--after") }
              : options.before !== undefined
                ? { before: client.messages.moment(String(options.before)) }
                : {}
          const chatId = await client.chats.resolve(chat)
          renderPage(
            context,
            await client.messages.list(chatId, { limit: settings.limit, ...anchor }),
            feed(context),
            (items) =>
              "after" in anchor
                ? `newer ones: \`--after ${items.at(-1)?.id}\``
                : `older ones: \`--before ${items[0]?.id}\``,
          )
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  /**
   * **Search reads this machine's copy and never asks MAX.**
   *
   * There is no search operation in MAX's protocol as we know it, so there is nothing to send.
   * That makes this command the opposite of every other read here — it opens no socket, spends no
   * login, and can only find what `max messages list` has already brought down.
   *
   * ⚠ **A short result is therefore ambiguous**, and the note on stderr is what resolves it: not
   * "there are no such messages", but "there are none in what has been read". Saying so costs one
   * line and is the difference between an answer and a misleading one.
   */
  command
    .command("search")
    .argument("<text>", "what to look for; at least 3 characters")
    .description("find messages in what this machine has already read")
    .option("--chat <id>", "only this chat; an id, because searching never connects to resolve a name")
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10))
    .action(async function (this: Command, text: string) {
      const options = this.optsWithGlobals()
      const context = forCommand(this)
      const { renderer, settings, createClient, run } = context
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("messages search", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}), offline: true })

        try {
          // Resolving a chat by name would need the chat list, which needs a login — and this
          // command promises not to. An id works offline; a name is refused with the reason.
          const chatId = options.chat === undefined ? undefined : offlineChat(String(options.chat))

          const found = await client.messages.search(text, {
            ...(chatId === undefined ? {} : { chatId }),
            limit: settings.limit,
          })

          renderer.note(
            found.items.length === 0
              ? "nothing matched what this machine has read — `max messages list <chat>` reads more"
              : "searched the local copy only; a chat nobody has opened is not in it",
          )
          renderPage(context, found, feed(context), () => "more matched — raise `--limit`")
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  command
    .command("show")
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "message id")
    .description("one message by its id")
    .action(async function (this: Command, chat: string, messageId: string) {
      await readWindow(this, chat, messageId, { before: 0, after: 0 }, "messages show")
    })

  command
    .command("context")
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "message id")
    .description("a message and what came either side of it, oldest first")
    .option("--before <n>", "how many before it", count, 5)
    .option("--after <n>", "how many after it", count, 5)
    .action(async function (this: Command, chat: string, messageId: string) {
      const { before, after } = this.opts<{ before: number; after: number }>()
      await readWindow(this, chat, messageId, { before, after }, "messages context")
    })

  command
    .command("download")
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "message id")
    .description("save a message's photos, files, videos and audio to a directory")
    .option("--output <dir>", "where to save them", ".")
    .action(async function (this: Command, chat: string, messageId: string) {
      const { output } = this.opts<{ output: string }>()
      const context = forCommand(this)
      const { renderer, format, streams, createClient, run } = context

      await run("messages download", async (events) => {
        const client = createClient({ events })
        try {
          const chatId = await client.chats.resolve(chat)
          const id = messageId.trim()
          const { links, skipped } = await client.messages.links(chatId, id)
          if (skipped.length > 0) renderer.note(`not downloadable: ${skipped.join(", ")}`)
          if (links.length === 0) throw new CliError("not_found", `message ${id} has nothing to download`)

          const saved: Saved[] = []
          for (const [index, attachment] of links.entries()) {
            if (attachment.unsafe) renderer.note(`MAX marks ${attachment.name ?? "this file"} as possibly unsafe`)
            saved.push(await save(attachment, output, `${id}-${index + 1}`))
          }

          if (format === "pretty") streams.data(`${saved.map((file) => file.path).join("\n")}\n`)
          else renderer.result({ items: saved })
        } finally {
          await client.close()
        }
      })
    })

  /**
   * One message, one command, no retry.
   *
   * There is no `--dry-run` here: the target and the text are both in the line the person typed, so
   * a preview would restate the command back at them (REQUIREMENTS §21). What this command does owe
   * the caller is honesty about an outcome it does not know — see `MaxClient.messages.send`.
   *
   * **The body may come from a pipe instead**, by leaving the argument off — `readBody` says why
   * argv is the wrong place for it and why omission is the signal rather than a flag.
   */
  command
    .command("send")
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("[text]", "what to say; leave it off to read the message from stdin")
    .description("send one text message")
    .option("--cid <n>", "reuse a client id from an earlier ambiguous send; MAX collapses the duplicate", (value) =>
      Number.parseInt(value, 10),
    )
    // `notify` is part of MSG_SEND and has always been sent as `true`. It is the one send option
    // whose absence is felt at the other end rather than here: a script posting at 3am wakes
    // somebody up, and there was no way to say otherwise.
    .option("--silent", "deliver without a notification")
    .option("--reply-to <message>", "answer this message id in the same chat")
    .option("--md, --markdown", "read **bold**, _italic_, ~~struck~~ and `code` in the text; \\ keeps a mark literal")
    .action(async function (this: Command, chat: string, text: string | undefined) {
      const options = this.optsWithGlobals()
      const { renderer, settings, createClient, run } = forCommand(this)

      // Before the run directory and before the socket: a body we cannot read is a command that
      // never attempted anything, so there is nothing to record and nothing to close.
      const body = text ?? (await readBody())

      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("messages send", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const chatId = await client.chats.resolve(chat)
          const sent = await client.messages.send(chatId, body, {
            ...(options.cid === undefined ? {} : { cid: options.cid }),
            ...(options.silent === true ? { notify: false } : {}),
            ...(options.replyTo === undefined ? {} : { replyTo: String(options.replyTo).trim() }),
            ...(options.markdown === true ? { markdown: true } : {}),
          })
          renderer.result(sent)
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}

const feed =
  ({ color, settings }: CommandContext) =>
  (messages: Message[]) =>
    renderMessages(messages, {
      color,
      senderColors: settings.senderColors,
      verbosity: settings.detail,
      width: process.stdout.columns ?? 80,
      profile: settings.profile,
    })

/**
 * `--chat` on a search takes an id, because resolving a name needs the chat list and the chat list
 * needs a login — which this command promises not to spend. Refused by name rather than silently
 * searching every chat, since "I asked for one chat and got all of them" is a wrong answer.
 */
const offlineChat = (reference: string): Id => {
  const trimmed = reference.trim()
  if (/^-?\d+$/.test(trimmed)) return trimmed
  throw new CliError(
    "validation_error",
    `\`messages search --chat\` takes a chat id, not a name — searching never connects, and a name ` +
      `can only be resolved by asking MAX. \`max chats list --search ${trimmed}\` gives you the id.`,
  )
}

const count = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new CliError("validation_error", `expected a number from 0 to 100, not "${value}"`)
  }
  return parsed
}

/**
 * `show` is a window of none either side. **In JSON the one asked for carries `anchor: true`**
 * (`NEED-131`); `show` answers the bare message, `context` an object holding the window.
 */
const readWindow = async (
  command: Command,
  chat: string,
  messageId: string,
  window: { before: number; after: number },
  name: string,
): Promise<void> => {
  const context = forCommand(command)
  const { renderer, settings, createClient, run, format, streams } = context
  const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

  await run(name, async (events) => {
    const client = createClient({ events, ...(cache ? { cache } : {}) })
    try {
      const chatId = await client.chats.resolve(chat)
      const found: WindowedMessage[] = await client.messages.around(chatId, messageId.trim(), window)
      const single = window.before === 0 && window.after === 0

      if (format === "pretty") streams.data(feed(context)(found))
      else if (format === "jsonl") renderer.stream(found)
      else renderer.result(single ? found[0] : { items: found })
    } finally {
      await client.close()
      cache?.close()
    }
  })
}
