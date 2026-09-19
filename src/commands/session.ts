import { Command } from "commander"
import { MaxClient } from "../client.js"
import { resolveOutput } from "../output.js"
import { readSecret } from "../session/prompt.js"
import { SessionStore } from "../session/store.js"

export const sessionCommand = (): Command => {
  const command = new Command("session").description("the stored MAX session for this profile")

  /**
   * For now, importing a token obtained elsewhere — from `web.max.ru`, or from another client.
   *
   * This is not a stopgap: it is the escape hatch that keeps every other command usable when our
   * own login flow meets a captcha or an unusual second factor, and it is how the slice is tested
   * without an SMS per run. The interactive phone-and-code flow lands beside it, not instead of it.
   *
   * **The token is asked for, not passed.** A token in argv is read by `ps` and kept by shell
   * history, and a file leaves a copy nobody deletes, so with `MAX_TOKEN` unset it is read from the
   * terminal without being echoed — or from a pipe, for `pass show max | max session start`. From
   * there it goes to the OS keyring.
   */
  command
    .command("start")
    .description("store a MAX session for this profile")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const token = process.env.MAX_TOKEN?.trim() || (await readSecret("MAX token: "))

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
        const profile = client.account.me()
        renderer.result({ profile, stored: true })
        renderer.success(`logged in as ${profile.name ?? profile.id}`)
      } finally {
        await client.close()
      }
    })

  /**
   * Local only, for now: it forgets the token and the device identity on this machine.
   *
   * It does **not** send LOGOUT (opcode 20), which would end the session on MAX's side too — and
   * with it the browser tab the token came from. That distinction is in the output rather than
   * glossed over: a forgotten token that is still live elsewhere is a different thing from a
   * revoked one.
   */
  command
    .command("end")
    .description("forget the stored session for this profile")
    .action(function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const store = new SessionStore({ profile: options.profile })
      const had = store.forget()

      renderer.result({ profile: store.profile, forgotten: had, revokedOnServer: false })
      if (had) renderer.success(`forgot the session for "${store.profile}" on this machine`)
      else renderer.note(`there was no session for "${store.profile}"`)
    })

  return command
}
