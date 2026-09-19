import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { recorded } from "../runs/recording.js"
import { SessionStore } from "../session/store.js"

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
    .option("--limit <n>", "how many to read", (value) => Number.parseInt(value, 10), 20)
    .action(async function (this: Command, chat: string) {
      const options = this.optsWithGlobals()
      const { renderer, format } = resolveOutput(options)
      const store = new SessionStore({ profile: options.profile })
      const cache = await openProfileCache(options.profile, { onProblem: (message) => renderer.note(message) })

      await recorded({ command: "messages list", profile: store.profile, options, format }, async (events) => {
        const client = new MaxClient({ store, events, ...(cache ? { cache } : {}) })

        try {
          const chatId = await client.chats.resolve(chat)
          renderer.result(await client.messages.list(chatId, options.limit))
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
      const { renderer, format } = resolveOutput(options)
      const store = new SessionStore({ profile: options.profile })
      const cache = await openProfileCache(options.profile, { onProblem: (message) => renderer.note(message) })

      await recorded({ command: "messages send", profile: store.profile, options, format }, async (events) => {
        const client = new MaxClient({ store, events, ...(cache ? { cache } : {}) })

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
