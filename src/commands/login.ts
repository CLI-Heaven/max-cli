import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { SessionStore } from "../session/store.js"

/**
 * For now, importing a token obtained elsewhere — from `web.max.ru`, or from another client.
 *
 * This is not a stopgap: it is the escape hatch that keeps every other command usable when our own
 * login flow meets a captcha or an unusual second factor, and it is how the slice is tested
 * without an SMS per run. The interactive phone-and-code flow lands beside it, not instead of it.
 */
export const loginCommand = (): Command =>
  new Command("login")
    .description("store a MAX session for this profile")
    .option("--token <token>", "a session token; read from MAX_TOKEN when omitted")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const token = options.token ?? process.env.MAX_TOKEN

      if (!token) {
        renderer.failure("no token given: pass --token, or set MAX_TOKEN")
        process.exitCode = 2
        return
      }

      const store = new SessionStore({ profile: options.profile })
      store.writeToken(token)

      const client = new MaxClient({ store })
      try {
        await client.connect()
        const profile = client.me()
        renderer.result({ profile, stored: true })
        renderer.success(`logged in as ${profile.name ?? profile.id}`)
      } finally {
        await client.close()
      }
    })
