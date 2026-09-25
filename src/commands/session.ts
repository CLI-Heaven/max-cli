import { Argument, Command } from "commander"
import { type MaxClientOptions, refuseWhilePaused } from "../client.js"
import { commandWords, refuseCommandName, rootOf } from "../profile.js"
import { stopServer } from "../server/server-connection.js"
import { adoptToken } from "../session/adopt.js"
import { serveQrPage } from "../session/browser.js"
import { readSecret } from "../session/prompt.js"
import { terminalQr } from "../session/qr-terminal.js"
import { type CommandContext, forCommand } from "./context.js"

// NEED-149: gentle on purpose — it asks for ordinary use alongside, and does not cite blocked accounts.
const TERMS_NOTICE = [
  "max is not the official MAX app, and the MAX terms do not allow automated programs (legal.max.ru/ps, 4.3.7).",
  "Keep using MAX as usual in the browser or on your phone alongside it. More: docs/security.md",
].join("\n")

export const sessionCommand = (): Command => {
  const command = new Command("session").description("the stored MAX session for this profile")

  /**
   * Four ways to a token, and one way to keep it: whatever produced the token, it reaches the
   * keyring only once MAX has accepted it (`adoptToken`).
   *
   * - `token` — pasted, or piped: `pass show max | max session start`. The default, and the escape
   *   hatch when a login meets a captcha or an unusual second factor.
   * - `qr` — our own connection asks MAX for the code; it is drawn here, or opened in the default
   *   browser when the terminal is too narrow for it.
   * - `qr-chrome`, `sms` — web.max.ru itself does the login, in a Chromium-family browser with a
   *   throwaway profile, and we read the token it stores. MAX sees its own web client. SMS has no
   *   other door: asked over our socket, MAX demands a captcha only the page can solve (2026-09-24).
   *
   * **A token is never an argument.** argv is read by `ps` and kept by shell history.
   */
  command
    .command("start")
    .description("log this profile in to MAX")
    .addArgument(
      new Argument("[method]", "token (pasted or piped), qr, qr-chrome or sms").choices(METHODS).default("token"),
    )
    .action(async function (this: Command, method: Method) {
      const context = forCommand(this)
      const { renderer, settings, store, createClient, run, interactive } = context

      // Creation is the only moment the collision can still be explained; after this the name is
      // written down and `max <name>` would silently be a command instead.
      refuseCommandName(settings.profile, commandWords(rootOf(this)))
      // Before `qr` asks MAX for a code over our socket: PyMax #106 hit the limit on exactly that.
      if (store.hasLoggedIn()) refuseWhilePaused(store.readState())

      if (method !== "token" && !interactive) {
        renderer.failure(`\`session start ${method}\` needs a person at a terminal — use \`session start token\``)
        process.exitCode = 2
        return
      }

      // It outranks the keyring, so every later command would still log in with it and the new
      // session would look as if it had not worked.
      if (method !== "token" && process.env.MAX_TOKEN) {
        renderer.failure("MAX_TOKEN is set, and it would outrank the new session — unset it first")
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
        // One connection per profile at any moment (`NEED-229`): a login needs one of its own — MAX
        // logs in before there is a token to share — so the server holding the old session goes
        // first, and comes back on the new one below.
        if ((await context.stopServer()) === "stopped")
          renderer.note("stopped `max serve`; it starts again on the new session")
        const token = method === "token" ? String(pasted) : await obtain(method, context, events)
        const client = createClient({ events }, { own: true })

        // No account on record means this profile has never logged in, or `session end` forgot it.
        const firstLogin = store.readState().viewerId === undefined

        try {
          await adoptToken(client, store, token)
          const profile = await client.account.me()
          renderer.result({ profile, stored: true, method })
          renderer.success(`logged in as ${profile.name ?? profile.id}`)
          if (firstLogin) renderer.note(TERMS_NOTICE)
        } finally {
          await client.close()
        }
        if (await context.shareServer()) renderer.note("`max serve` is up on the new session")
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
        // A server still logged in with the forgotten session would keep using it.
        const server = await stopServer(store.socketPath())
        const had = store.forget()
        if (server === "refused") {
          renderer.note("a `max serve` you started by hand is still running with that session — Ctrl-C it")
        }

        renderer.result({ profile: store.profile, forgotten: had, revokedOnServer: false })
        if (had) renderer.success(`forgot the session for "${store.profile}" on this machine`)
        else renderer.note(`there was no session for "${store.profile}"`)
      })
    })

  return command
}

const METHODS = ["token", "qr", "qr-chrome", "sms"] as const
type Method = (typeof METHODS)[number]

/** Long enough to find the phone and type a number and a code; the profile dies with the wait. */
const BROWSER_WAIT_MS = 5 * 60_000

const obtain = async (
  method: Exclude<Method, "token">,
  { createClient, renderer, browser, track, ask, streams, columns }: CommandContext,
  events: MaxClientOptions["events"],
): Promise<string> => {
  if (method !== "qr") {
    renderer.note(
      method === "qr-chrome"
        ? "web.max.ru is opening in a separate browser window — scan its QR code with the MAX app on your phone"
        : "web.max.ru is opening in a separate browser window — choose to log in by phone number there",
    )
    return await browser.chromiumToken({ track, waitMs: BROWSER_WAIT_MS })
  }

  const client = createClient({ events }, { own: true })
  let page: Awaited<ReturnType<typeof serveQrPage>> | undefined
  try {
    return await client.login.byQr({
      show: async (link) => {
        const drawn = terminalQr(link)
        // Straight to the diagnostic stream, not through the renderer: --quiet must not hide the code.
        if (columns !== undefined && drawn.width <= columns) {
          streams.diagnostic(drawn.text)
          renderer.note("scan this code with the MAX app on your phone")
          return
        }
        page = await serveQrPage(link)
        track(page)
        await browser.open(page.url)
        renderer.note("the terminal is too narrow for the QR code, so it is open in your browser — scan it there")
      },
      askPassword: (hint, again) =>
        ask(`${again ? "wrong password, try again" : "MAX password"}${hint ? ` (hint: ${hint})` : ""}: `, {
          secret: true,
        }),
    })
  } finally {
    await page?.close()
    await client.close()
  }
}
