import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { ChatKind } from "../domain/models.js"
import { forCommand } from "./context.js"
import { renderPage, window, withPaging } from "./paging.js"

export const chatsCommand = (): Command => {
  const command = new Command("chats").description("the chats this account is in")

  withPaging(command.command("list").description("the chats this account is in"))
    .option("--search <text>", "only chats whose name contains this; at least 3 characters")
    .option("--kind <dialog|group|channel>", "only chats of this kind")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const context = forCommand(this)
      const { renderer, settings, createClient, run } = context
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("chats list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderPage(
            context,
            await client.chats.list({
              ...window(settings),
              ...(options.search === undefined ? {} : { query: String(options.search) }),
              ...(options.kind === undefined ? {} : { kind: chatKind(options.kind) }),
            }),
          )
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}

/**
 * `--kind` is checked here and refused by name, rather than passed through to return nothing.
 *
 * A value the tool does not know is a typo, and an empty list is the one answer a typo must never
 * produce — it is indistinguishable from "you are in no group chats".
 */
const chatKind = (value: unknown): ChatKind => {
  const wanted = String(value).toLowerCase()
  if (wanted === "dialog" || wanted === "group" || wanted === "channel") return wanted
  throw new CliError("validation_error", `--kind takes dialog, group or channel, not "${String(value)}"`)
}
