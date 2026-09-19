import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

export const accountCommand = (): Command => {
  const command = new Command("account").description("the account this profile is logged in as")

  command
    .command("show")
    .description("who this profile is logged in as")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const client = new MaxClient({ store: new SessionStore({ profile: options.profile }) })

      try {
        await client.connect()
        renderer.result(client.account.me())
      } finally {
        // Nothing below this line: an open socket keeps the process alive after the answer printed.
        await client.close()
      }
    })

  return command
}
