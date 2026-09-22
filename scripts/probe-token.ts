/**
 * Does the login answer carry a rotated token? Run by hand, never by CI.
 *
 *   max session start     # once, if there is no session on this profile
 *   pnpm probe:token
 *
 * `MAX-11` says "persist the rotated token the login response returns", and
 * `src/spec/operations/session.ts` declares no such field. The basis is `NEED-8`, which cites
 * **somebody else's client** — `tsmax/src/app.ts:99` — for the claim that clients rotate it. That
 * is a claim, not a measurement: nothing here has ever looked at what MAX actually sends us.
 *
 * Three outcomes, and each decides the work differently:
 *
 * - **no token-shaped key** — `MAX-11` has no operation behind it and the backlog is wrong;
 * - **a key that always equals what we sent** — persisting it is a no-op dressed as a feature;
 * - **a key that differs** — `MAX-11` is real and this says which field it is.
 *
 * Measured 2026-09-22: `token` differs when the credential presented is an old one, and repeats
 * once it has been exchanged. So run this on a profile that has not logged in since the exchange,
 * or it will truthfully report no difference and mean the opposite of what it looks like.
 *
 * ⚠ **It prints key names, types and booleans. Never a value**, never a prefix, never a length:
 * a token compared by eye is a token on a screen, and this runs against a real account. It writes
 * nothing — not the keyring, not the state file.
 */
import { Connection } from "../dist/protocol/connection.js"
import { SessionStore } from "../dist/session/store.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { buildRequest, checkResponse } from "../dist/spec/index.js"
import { sessionInit, sessionLogin } from "../dist/spec/operations/session.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()

if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const { deviceId } = store.readState()
const connection = new Connection({ timeoutMs: 20_000 })

/** A key that might hold a credential. Deliberately wide: the point is to find it, not to guess it. */
const looksLikeToken = (key: string): boolean => /token|auth|session|credential|key/i.test(key)

try {
  await connection.open()
  await connection.invoke(sessionInit.opcode, buildRequest(sessionInit, { userAgent: WEB_USER_AGENT, deviceId }))

  const login = await connection.invoke(
    sessionLogin.opcode,
    buildRequest(sessionLogin, {
      token,
      interactive: false,
      chatsCount: 1,
      chatsSync: 0,
      contactsSync: 0,
      presenceSync: 0,
      draftsSync: 0,
    }),
  )

  const keys = Object.keys(login).sort()
  console.log(`the login answer carries these fields:\n  ${keys.join(", ")}\n`)

  const candidates = keys.filter(looksLikeToken)
  if (candidates.length === 0) {
    console.log("no field whose name could hold a credential.")
    console.log("→ MAX-11 has nothing to persist; the claim came from another client, not from ours.")
  }

  for (const key of candidates) {
    const value = (login as Record<string, unknown>)[key]
    const isString = typeof value === "string"
    console.log(`\`${key}\`: ${isString ? "a string" : typeof value}`)
    if (!isString) continue

    // The only comparison that ever happens, and it yields one boolean.
    console.log(`  empty: ${value === ""}`)
    console.log(`  same as the one we sent: ${value === token}`)
  }

  const note = checkResponse(sessionLogin, login)
  if (note) console.log(`\nthe response check says: ${note}`)
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await connection.close()
}
