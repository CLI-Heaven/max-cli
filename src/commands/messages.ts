import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { forCommand } from "./context.js"
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
    .action(async function (this: Command, chat: string) {
      const options = this.optsWithGlobals()
      const context = forCommand(options)
      const { renderer, settings, createClient, run } = context
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("messages list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const chatId = await client.chats.resolve(chat)
          const before = options.before === undefined ? {} : { before: client.messages.before(String(options.before)) }
          renderPage(context, await client.messages.list(chatId, { limit: settings.limit, ...before }))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  /**
   * One message, one command, no retry.
   *
   * There is no `--dry-run` here: the target and the text are both in the line the person typed, so
   * a preview would restate the command back at them (REQUIREMENTS §21). What this command does owe
   * the caller is honesty about an outcome it does not know — see `MaxClient.messages.send`.
   */
  command
    .command("send")
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<text>", "what to say")
    .description("send one text message")
    .option("--cid <n>", "reuse a client id from an earlier ambiguous send; MAX collapses the duplicate", (value) =>
      Number.parseInt(value, 10),
    )
    .action(async function (this: Command, chat: string, text: string) {
      const options = this.optsWithGlobals()
      const { renderer, settings, createClient, run } = forCommand(options)
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("messages send", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const chatId = await client.chats.resolve(chat)
          const sent = await client.messages.send(chatId, text, options.cid === undefined ? {} : { cid: options.cid })
          renderer.result(sent)
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}
