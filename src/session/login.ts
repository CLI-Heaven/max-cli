import { setTimeout as delay } from "node:timers/promises"
import { CliError } from "@leemour/cli-core"
import type { WireClient } from "../generated/client.generated.js"
import type { Payload } from "../protocol/frame.js"

export interface SecondFactor {
  /** Asked only when the account has a cloud password; `again` after a wrong one. */
  askPassword: (hint: string | undefined, again: boolean) => Promise<string>
}

export interface QrLogin extends SecondFactor {
  /** Put the code where a phone can scan it. Resolves once it is shown, not once it is scanned. */
  show: (link: string) => Promise<void>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The login MAX's web client does itself when it shows a QR code: ask for a code, wait until a phone
 * approves it, then exchange it for a token. Shapes from PyMax 2.4.1 (`auth/qr.py`), not measured.
 *
 * One code per run: an expired one is an error rather than a fresh code, so a person who walked
 * away does not come back to a loop that has been asking MAX for codes all along.
 */
export const tokenByQr = async (
  wire: WireClient,
  { show, askPassword, now = Date.now, sleep = delay }: QrLogin,
): Promise<string> => {
  const code = await wire.login.qrRequest({})
  const trackId = text(code.trackId, "trackId")
  const expiresAt = typeof code.expiresAt === "number" ? code.expiresAt : now() + 120_000
  const interval = typeof code.pollingInterval === "number" ? code.pollingInterval : 5_000

  await show(text(code.qrLink, "qrLink"))

  while (now() < expiresAt) {
    const answer = await wire.login.qrStatus({ trackId })
    if (record(answer.status)?.loginAvailable === true) {
      return await tokenFrom(wire, await wire.login.byQr({ trackId }), askPassword)
    }
    await sleep(interval)
  }

  throw new CliError("timeout", "the QR code expired before it was scanned — run the command again")
}

/**
 * A few attempts, not PyMax's endless loop, and not one: a mistyped password would otherwise cost a
 * fresh QR code. Only a person at a terminal gets here, so asking again cannot hang a script.
 */
const tokenFrom = async (wire: WireClient, answer: Payload, askPassword: SecondFactor["askPassword"]) => {
  const issued = loginToken(answer)
  if (issued) return issued

  const challenge = record(answer.passwordChallenge)
  if (!challenge) throw new CliError("authentication_error", "MAX confirmed the login but sent no token")

  const trackId = text(challenge.trackId, "trackId")
  const hint = typeof challenge.hint === "string" && challenge.hint !== "" ? challenge.hint : undefined

  for (let attempt = 1; attempt <= PASSWORD_ATTEMPTS; attempt++) {
    const password = await askPassword(hint, attempt > 1)
    if (!password) throw new CliError("validation_error", "no password given")

    const checked = await wire.login.password({ trackId, password }).catch((error: unknown) => {
      if (wrongPassword(error)) return undefined
      throw error
    })
    const token = checked && loginToken(checked)
    if (token) return token
  }
  throw new CliError(
    "authentication_error",
    `the password was wrong ${PASSWORD_ATTEMPTS} times — run the command again`,
  )
}

const PASSWORD_ATTEMPTS = 3

// Measured 2026-09-24: a wrong cloud password is refused as `password2fa.wrong`.
const wrongPassword = (error: unknown): boolean => error instanceof CliError && /password2fa\.wrong/.test(error.message)

const loginToken = (answer: Payload): string | undefined => {
  const token = record(record(answer.tokenAttrs)?.LOGIN)?.token
  return typeof token === "string" && token !== "" ? token : undefined
}

const text = (value: unknown, field: string): string => {
  if (typeof value === "string" && value !== "") return value
  throw new CliError("provider_error", `MAX's answer had no ${field}`)
}

const record = (value: unknown): Payload | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : undefined
