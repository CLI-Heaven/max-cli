import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

/**
 * One message, one command, no retry.
 *
 * There is no `--dry-run` here: the target and the text are both in the line the person typed, so
 * a preview would restate the command back at them (REQUIREMENTS §21). What this command does owe
 * the caller is honesty about an outcome it does not know — see `MaxClient.sendMessage`.
 */
export const sendCommand = (): Command =>
  new Command("send")
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<text>", "what to say")
    .description("send one text message")
    .option("--cid <n>", "reuse a client id from an earlier ambiguous send; MAX collapses the duplicate", (value) =>
      Number.parseInt(value, 10),
    )
    .action(async function (this: Command, chat: string, text: string) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const client = new MaxClient({ store: new SessionStore({ profile: options.profile }) })

      try {
        await client.connect()
        const chatId = await client.resolveChat(chat)
        renderer.result(await client.sendMessage(chatId, text, options.cid === undefined ? {} : { cid: options.cid }))
      } finally {
        await client.close()
      }
    })
