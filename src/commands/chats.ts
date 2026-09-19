import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

export const chatsCommand = (): Command =>
  new Command("chats")
    .description("the chats this account is in")
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10), 20)
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const client = new MaxClient({ store: new SessionStore({ profile: options.profile }) })

      try {
        await client.connect()
        renderer.result(await client.listChats(options.limit))
      } finally {
        await client.close()
      }
    })
