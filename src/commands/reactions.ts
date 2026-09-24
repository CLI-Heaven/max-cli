import { annotate } from "@leemour/cli-core/commands"
import { Command } from "commander"
import { forCommand } from "./context.js"

export const reactionsCommand = (): Command => {
  const command = new Command("reactions").description("react to messages")

  annotate(command.command("add"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "message id")
    .argument("<emoji>", "one emoji, for example 👍")
    .description("put your reaction on a message; it replaces the one you had")
    .action(async function (this: Command, chat: string, messageId: string, emoji: string) {
      const { renderer, createClient, run } = forCommand(this)

      await run("reactions add", async (events) => {
        const client = createClient({ events })
        try {
          const chatId = await client.chats.resolve(chat)
          renderer.result(await client.messages.react(chatId, messageId.trim(), emoji.trim()))
        } finally {
          await client.close()
        }
      })
    })

  annotate(command.command("remove"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "message id")
    .description("take your reaction off a message")
    .action(async function (this: Command, chat: string, messageId: string) {
      const { renderer, createClient, run } = forCommand(this)

      await run("reactions remove", async (events) => {
        const client = createClient({ events })
        try {
          const chatId = await client.chats.resolve(chat)
          renderer.result(await client.messages.unreact(chatId, messageId.trim()))
        } finally {
          await client.close()
        }
      })
    })

  return command
}
