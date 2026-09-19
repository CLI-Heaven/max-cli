import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { readSecret } from "../session/prompt.js"
import { SessionStore } from "../session/store.js"

/**
 * For now, importing a token obtained elsewhere — from `web.max.ru`, or from another client.
 *
 * This is not a stopgap: it is the escape hatch that keeps every other command usable when our own
 * login flow meets a captcha or an unusual second factor, and it is how the slice is tested
 * without an SMS per run. The interactive phone-and-code flow lands beside it, not instead of it.
 *
 * **The token is asked for, not passed.** `--token` puts it in `ps` output and shell history, and a
 * file leaves a copy nobody deletes, so with neither given it is read from the terminal without
 * being echoed — or from a pipe, for `pass show max | max login`. From there it goes to the OS
 * keyring and nowhere else.
 */
export const loginCommand = (): Command =>
  new Command("login")
    .description("store a MAX session for this profile")
    .option("--token <token>", "a session token; prompted for, or read from a pipe, when omitted")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const token = options.token ?? process.env.MAX_TOKEN?.trim() ?? (await readSecret("MAX token: "))

      if (!token) {
        renderer.failure("no token given")
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
