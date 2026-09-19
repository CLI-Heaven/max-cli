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
    .argument("<chat>", "chat id")
    .argument("<text>", "what to say")
    .description("send one text message")
    .action(async function (this: Command, chat: string, text: string) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const client = new MaxClient({ store: new SessionStore({ profile: options.profile }) })

      try {
        await client.connect()
        renderer.result(await client.sendMessage(chat, text))
      } finally {
        await client.close()
      }
    })
