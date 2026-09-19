import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { forCommand } from "./context.js"

export const chatsCommand = (): Command => {
  const command = new Command("chats").description("the chats this account is in")

  command
    .command("list")
    .description("the chats this account is in")
    // No default on the option: with one, the flag is always set and a configured `limit` could
    // never win it. The number lives once, in `resolveSettings`.
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10))
    .action(async function (this: Command) {
      const { renderer, settings, createClient, run } = forCommand(this.optsWithGlobals())
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("chats list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderer.result(await client.chats.list(settings.limit))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}
