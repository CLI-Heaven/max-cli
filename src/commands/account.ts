import { Command } from "commander"
import { forCommand } from "./context.js"

export const accountCommand = (): Command => {
  const command = new Command("account").description("the account this profile is logged in as")

  command
    .command("show")
    .description("who this profile is logged in as")
    .action(async function (this: Command) {
      const { renderer, createClient, run } = forCommand(this)

      await run("account show", async (events) => {
        const client = createClient({ events })

        try {
          await client.connect()
          renderer.result(client.account.me())
        } finally {
          // Nothing below this line: an open socket keeps the process alive after the answer printed.
          await client.close()
        }
      })
    })

  return command
}
