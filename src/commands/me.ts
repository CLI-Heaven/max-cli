import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

export const meCommand = (): Command =>
  new Command("me").description("who this profile is logged in as").action(async function (this: Command) {
    const options = this.optsWithGlobals()
    const { renderer } = resolveOutput(options)
    const client = new MaxClient({ store: new SessionStore({ profile: options.profile }) })

    try {
      await client.connect()
      renderer.result(client.me())
    } finally {
      // Nothing below this line: an open socket keeps the process alive after the answer printed.
      await client.close()
    }
  })
