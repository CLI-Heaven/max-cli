import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

/**
 * Observational, and deliberately so: this reads `CHAT_HISTORY` and never sends `CHAT_MARK`, so
 * looking at a conversation does not tell anyone you read it (REQUIREMENTS §19).
 */
export const messagesCommand = (): Command =>
  new Command("messages")
    .argument("<chat>", "chat id, or part of a chat name")
    .description("recent messages in a chat, oldest first")
    .option("--limit <n>", "how many to read", (value) => Number.parseInt(value, 10), 20)
    .action(async function (this: Command, chat: string) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const client = new MaxClient({ store: new SessionStore({ profile: options.profile }) })

      try {
        await client.connect()
        const chatId = await client.chats.resolve(chat)
        renderer.result(await client.messages.list(chatId, options.limit))
      } finally {
        await client.close()
      }
    })
