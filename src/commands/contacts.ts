import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { forCommand } from "./context.js"

/**
 * The people this account has a one-to-one chat with.
 *
 * Not "the address book": MAX has an opcode that tsmax calls `CONTACT_LIST` and the protocol
 * documentation calls `GET_BLOCKED`, and until somebody has watched what it actually returns, this
 * lists what we can establish without guessing.
 */
export const contactsCommand = (): Command => {
  const command = new Command("contacts").description("people you have a one-to-one chat with")

  command
    .command("list")
    .description("people you have a one-to-one chat with")
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10))
    .action(async function (this: Command) {
      const { renderer, settings, createClient, run } = forCommand(this.optsWithGlobals())
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("contacts list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderer.result((await client.contacts.list({ limit: settings.limit })).items)
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  /**
   * The repair tool of the contact store, and **not how contacts normally arrive**: every command
   * logs in, and every login carries the delta, so the store is already current. This is for a
   * store that has drifted, or one a schema rebuild emptied.
   *
   * ⚠ **The summary is counts.** No name, no username, no description, no phone number — a person
   * in a diagnostic is the one leak this project's sixth constraint is about.
   */
  command
    .command("sync")
    .description("forget where the last sync left off and take the whole list again")
    .action(async function (this: Command) {
      const { renderer, settings, createClient, run } = forCommand(this.optsWithGlobals())
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("contacts sync", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const summary = await client.contacts.sync()
          renderer.result(summary)
          renderer.success(`${summary.added} new, ${summary.changed} changed, ${summary.known} people known`)
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}
