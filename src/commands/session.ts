import { CliError } from "@leemour/cli-core"
import { Argument, Command } from "commander"
import type { MaxClientOptions } from "../client.js"
import { commandWords, refuseCommandName, rootOf } from "../profile.js"
import { adoptToken } from "../session/adopt.js"
import { serveQrPage } from "../session/browser.js"
import { readSecret } from "../session/prompt.js"
import { type CommandContext, forCommand } from "./context.js"

// NEED-149: gentle on purpose — it asks for ordinary use alongside, and does not cite blocked accounts.
const TERMS_NOTICE = [
  "max is not the official MAX app, and the MAX terms do not allow automated programs (legal.max.ru/ps, 4.3.7).",
  "Keep using MAX as usual in the browser or on your phone alongside it. More: docs/security.md",
].join("\n")

export const sessionCommand = (): Command => {
  const command = new Command("session").description("the stored MAX session for this profile")

  /**
   * Five ways to a token, and one way to keep it: whatever produced the token, it reaches the
   * keyring only once MAX has accepted it (`adoptToken`).
   *
   * - `token` — pasted, or piped: `pass show max | max session start`. The default, and the escape
   *   hatch when a login meets a captcha or an unusual second factor.
   * - `qr`, `sms` — our own connection asks MAX for the QR code or the SMS; the code is shown in
   *   whatever browser the system opens, the SMS code is typed here.
   * - `qr-chrome`, `sms-chrome` — web.max.ru itself does the login, in a Chromium-family browser
   *   with a throwaway profile, and we read the token it stores. MAX sees its own web client.
   *
   * **A token is never an argument.** argv is read by `ps` and kept by shell history.
   */
  command
    .command("start")
    .description("log this profile in to MAX")
    .addArgument(
      new Argument("[method]", "token (pasted or piped), qr, qr-chrome, sms or sms-chrome")
        .choices(METHODS)
        .default("token"),
    )
    .action(async function (this: Command, method: Method) {
      const context = forCommand(this)
      const { renderer, settings, store, createClient, run, interactive } = context

      // Creation is the only moment the collision can still be explained; after this the name is
      // written down and `max <name>` would silently be a command instead.
      refuseCommandName(settings.profile, commandWords(rootOf(this)))

      if (method !== "token" && !interactive) {
        renderer.failure(`\`session start ${method}\` needs a person at a terminal — use \`session start token\``)
        process.exitCode = 2
        return
      }

      const pasted = method === "token" ? process.env.MAX_TOKEN?.trim() || (await readSecret("MAX token: ")) : undefined

      // Before the run directory: nothing was attempted, so there is nothing to record.
      if (method === "token" && !pasted) {
        renderer.failure("no token given")
        process.exitCode = 2
        return
      }

      await run("session start", async (events) => {
        const token = method === "token" ? String(pasted) : await obtain(method, context, events)
        const client = createClient({ events })

        // No account on record means this profile has never logged in, or `session end` forgot it.
        const firstLogin = store.readState().viewerId === undefined

        try {
          await adoptToken(client, store, token)
          const profile = client.account.me()
          renderer.result({ profile, stored: true, method })
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

const METHODS = ["token", "qr", "qr-chrome", "sms", "sms-chrome"] as const
type Method = (typeof METHODS)[number]

/** Long enough to find the phone and type a number and a code; the profile dies with the wait. */
const BROWSER_WAIT_MS = 5 * 60_000

const obtain = async (
  method: Exclude<Method, "token">,
  { createClient, renderer, browser, track, ask }: CommandContext,
  events: MaxClientOptions["events"],
): Promise<string> => {
  if (method === "qr-chrome" || method === "sms-chrome") {
    renderer.note(
      method === "qr-chrome"
        ? "web.max.ru is opening in a separate browser window — scan its QR code with the MAX app on your phone"
        : "web.max.ru is opening in a separate browser window — choose to log in by phone number there",
    )
    return await browser.chromiumToken({ track, waitMs: BROWSER_WAIT_MS })
  }

  const askPassword = (hint: string | undefined) =>
    ask(hint ? `MAX password (hint: ${hint}): ` : "MAX password: ", { secret: true })
  const client = createClient({ events })
  try {
    if (method === "sms") {
      const phone = await ask("phone number, with the country code: ")
      if (!phone) throw new CliError("validation_error", "no phone number given")
      return await client.login.bySms({ phone, askCode: () => ask("code from the SMS: "), askPassword })
    }

    let page: Awaited<ReturnType<typeof serveQrPage>> | undefined
    try {
      return await client.login.byQr({
        show: async (link) => {
          page = await serveQrPage(link)
          track(page)
          await browser.open(page.url)
          renderer.note("the QR code is open in your browser — scan it with the MAX app on your phone")
        },
        askPassword,
      })
    } finally {
      await page?.close()
    }
  } finally {
    await client.close()
  }
}
