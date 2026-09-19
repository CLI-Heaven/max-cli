import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

export const chatsCommand = (): Command => {
  const command = new Command("chats").description("the chats this account is in")

  command
    .command("list")
    .description("the chats this account is in")
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10), 20)
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const cache = await openProfileCache(options.profile, { onProblem: (message) => renderer.note(message) })
      const client = new MaxClient({
        store: new SessionStore({ profile: options.profile }),
        ...(cache ? { cache } : {}),
      })

      try {
        renderer.result(await client.chats.list(options.limit))
      } finally {
        await client.close()
        cache?.close()
      }
    })

  return command
}
