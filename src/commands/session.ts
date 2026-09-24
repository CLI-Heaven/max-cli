import { Command } from "commander"
import { commandWords, refuseCommandName, rootOf } from "../profile.js"
import { adoptToken } from "../session/adopt.js"
import { readSecret } from "../session/prompt.js"
import { forCommand } from "./context.js"

// NEED-149: gentle on purpose — it asks for ordinary use alongside, and does not cite blocked accounts.
const TERMS_NOTICE = [
  "max is not the official MAX app, and the MAX terms do not allow automated programs (legal.max.ru/ps, 4.3.7).",
  "Keep using MAX as usual in the browser or on your phone alongside it. More: docs/security.md",
].join("\n")

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
   * there it goes to the OS keyring — **but only once MAX has accepted it**, which is `adoptToken`.
   */
  command
    .command("start")
    .description("store a MAX session for this profile")
    .action(async function (this: Command) {
      const { renderer, settings, store, createClient, run } = forCommand(this)

      // Creation is the only moment the collision can still be explained; after this the name is
      // written down and `max <name>` would silently be a command instead.
      refuseCommandName(settings.profile, commandWords(rootOf(this)))

      const token = process.env.MAX_TOKEN?.trim() || (await readSecret("MAX token: "))

      // Before the run directory: nothing was attempted, so there is nothing to record.
      if (!token) {
        renderer.failure("no token given")
        process.exitCode = 2
        return
      }

      await run("session start", async (events) => {
        const client = createClient({ events })

        // No account on record means this profile has never logged in, or `session end` forgot it.
        const firstLogin = store.readState().viewerId === undefined

        try {
          await adoptToken(client, store, token)
          const profile = client.account.me()
          renderer.result({ profile, stored: true })
          renderer.success(`logged in as ${profile.name ?? profile.id}`)
          if (firstLogin) renderer.note(TERMS_NOTICE)
        } finally {
          await client.close()
        }
      })
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
    .action(async function (this: Command) {
      const { renderer, store, run } = forCommand(this)

      // It contacts nobody, so the run holds no events — but forgetting a session is an action, and
      // "when did this profile stop working" is a question the record is kept to answer.
      await run("session end", async () => {
        const had = store.forget()

        renderer.result({ profile: store.profile, forgotten: had, revokedOnServer: false })
        if (had) renderer.success(`forgot the session for "${store.profile}" on this machine`)
        else renderer.note(`there was no session for "${store.profile}"`)
      })
    })

  return command
}
