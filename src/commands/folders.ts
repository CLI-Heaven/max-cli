import { annotate } from "@leemour/cli-core/commands"
import { Command } from "commander"
import { forCommand } from "./context.js"

const collect = (value: string, previous: string[] = []) => [...previous, value]

/** Under `chats`, not a word of its own: a new first word would take a name away from profiles. */
export const foldersCommand = (): Command => {
  const command = new Command("folders").description("your chat folders")

  command
    .command("list")
    .description("your chat folders, in the order MAX shows them")
    .action(async function (this: Command) {
      const { renderer, createClient, run } = forCommand(this)

      await run("chats folders list", async (events) => {
        const client = createClient({ events })

        try {
          renderer.result(await client.folders.list())
        } finally {
          await client.close()
        }
      })
    })

  annotate(command.command("create"), { mutates: true })
    .argument("<title>", "the folder's name; MAX refused 21 characters and took 15")
    .option("--chat <chat>", "a chat to put in it, by id or name; repeat it for more", collect)
    .description("create a chat folder")
    .action(async function (this: Command, title: string) {
      const options = this.opts<{ chat?: string[] }>()
      const { renderer, createClient, run } = forCommand(this)

      await run("chats folders create", async (events) => {
        const client = createClient({ events })

        try {
          renderer.result(await client.folders.create(title, options.chat))
        } finally {
          await client.close()
        }
      })
    })

  annotate(command.command("update"), { mutates: true })
    .argument("<folder>", "folder id, or its title exactly")
    .option("--title <title>", "a new name")
    .option("--add <chat>", "put a chat in it; repeat it for more", collect)
    .option("--remove <chat>", "take a chat out of it; repeat it for more", collect)
    .description("rename a folder, or change which chats are in it")
    .action(async function (this: Command, folder: string) {
      const options = this.opts<{ title?: string; add?: string[]; remove?: string[] }>()
      const { renderer, createClient, run } = forCommand(this)

      await run("chats folders update", async (events) => {
        const client = createClient({ events })

        try {
          renderer.result(await client.folders.update(folder, options))
        } finally {
          await client.close()
        }
      })
    })

  annotate(command.command("delete"), { mutates: true })
    .argument("<folder>", "folder id, or its title exactly")
    .description("delete a folder; the chats in it stay")
    .action(async function (this: Command, folder: string) {
      const { renderer, createClient, run } = forCommand(this)

      await run("chats folders delete", async (events) => {
        const client = createClient({ events })

        try {
          renderer.result(await client.folders.delete(folder))
        } finally {
          await client.close()
        }
      })
    })

  return command
}
