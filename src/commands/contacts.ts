import { readFile } from "node:fs/promises"
import { CliError } from "@leemour/cli-core"
import { annotate } from "@leemour/cli-core/commands"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { PersonOrder } from "../cache/store.js"
import type { PhoneBookEntry } from "../client.js"
import { forCommand } from "./context.js"
import { renderPage, window, withPaging } from "./paging.js"

/**
 * The people this account has a one-to-one chat with.
 *
 * Not "the address book": MAX has an opcode that tsmax calls `CONTACT_LIST` and the protocol
 * documentation calls `GET_BLOCKED`, and until somebody has watched what it actually returns, this
 * lists what we can establish without guessing.
 */
export const contactsCommand = (): Command => {
  const command = new Command("contacts").description("people you have a one-to-one chat with")

  withPaging(command.command("list").description("people you have a one-to-one chat with"))
    .option("--order <recent|name>", "newest conversation first, or alphabetical")
    .option("--search <text>", "only people whose name or @username contains this; at least 3 characters")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const context = forCommand(this)
      const { renderer, settings, createClient, run } = context
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      const order = orderFrom(options.order)

      await run("contacts list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderPage(
            context,
            await client.contacts.list({
              order,
              ...window(settings),
              ...(options.search === undefined ? {} : { query: String(options.search) }),
            }),
          )
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  command
    .command("show")
    .argument("<person>", "person id, @username, or part of a name")
    .description("one person and the chats you share with them")
    .action(async function (this: Command, person: string) {
      const { renderer, settings, createClient, run } = forCommand(this)
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("contacts show", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderer.result(await client.contacts.show(person))
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
      const { renderer, settings, createClient, run } = forCommand(this)
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

  /**
   * ⚠ **The number is asked for, never an argument**: argv is read by `ps` and kept by shell
   * history, and a phone number is what the sixth constraint names.
   */
  command
    .command("lookup")
    .description("who MAX has under a phone number — asks for it, or reads it from stdin")
    .action(async function (this: Command) {
      const { renderer, settings, createClient, run, ask } = forCommand(this)
      const phone = await ask("phone number: ")
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("contacts lookup", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderer.result(await client.contacts.lookup(phone))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  for (const [name, description] of [
    ["add", "add a person to your contacts — `contacts list` still shows only people you have a dialog with"],
    ["remove", "remove a person from your contacts; the chat with them stays"],
  ] as const) {
    annotate(command.command(name), { mutates: true })
      .argument("<person>", "person id — `contacts lookup` finds one — or part of a known name")
      .description(description)
      .action(async function (this: Command, person: string) {
        const { renderer, settings, createClient, run } = forCommand(this)
        const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

        await run(`contacts ${name}`, async (events) => {
          const client = createClient({ events, ...(cache ? { cache } : {}) })

          try {
            renderer.result(await client.contacts[name](person))
          } finally {
            await client.close()
            cache?.close()
          }
        })
      })
  }

  /** A file rather than lines on argv, for the same reason `lookup` asks: these are phone numbers. */
  annotate(command.command("import"), { mutates: true })
    .argument("<file>", "one person per line: number, then a comma or a tab, then the name")
    .description("upload phone numbers to MAX and add the people it has under them")
    .action(async function (this: Command, file: string) {
      const { renderer, settings, createClient, run } = forCommand(this)
      const entries = phoneBook(
        await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
          throw new CliError("not_found", `cannot read ${file}: ${error.code ?? error.message}`)
        }),
      )
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("contacts import", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const imported = await client.contacts.import(entries)
          renderer.result(imported)
          renderer.success(`${imported.sent} sent, ${imported.recognised.length} recognised by MAX`)
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}

/** ⚠ A bad line is named by its number, never by what is on it. */
export const phoneBook = (text: string): PhoneBookEntry[] =>
  text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim() === "") return []
    const match = /^\s*([^,\t;]+?)\s*[,\t;]\s*(.*\S)\s*$/.exec(line)
    if (!match?.[1] || !match[2]) {
      throw new CliError("validation_error", `line ${index + 1} is not "number, name"`)
    }
    return [{ phone: match[1], name: match[2] }]
  })

/**
 * ⚠ **A flag and no configuration field**, deliberately. `--order` and a `contactOrder` setting
 * would be two spellings of one thing, which is what `--profile` was deleted for.
 */
const orderFrom = (value: unknown): PersonOrder => {
  if (value === undefined) return "recent"
  if (value === "recent" || value === "name") return value
  throw new CliError("validation_error", `--order takes "recent" or "name", not "${String(value)}"`)
}
