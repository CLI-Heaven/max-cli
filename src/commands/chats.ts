import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { forCommand } from "./context.js"
import { renderPage, window, withPaging } from "./paging.js"

export const chatsCommand = (): Command => {
  const command = new Command("chats").description("the chats this account is in")

  withPaging(command.command("list").description("the chats this account is in")).action(async function (
    this: Command,
  ) {
    const context = forCommand(this.optsWithGlobals())
    const { renderer, settings, createClient, run } = context
    const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

    await run("chats list", async (events) => {
      const client = createClient({ events, ...(cache ? { cache } : {}) })

      try {
        renderPage(context, await client.chats.list(window(settings)))
      } finally {
        await client.close()
        cache?.close()
      }
    })
  })

  return command
}
