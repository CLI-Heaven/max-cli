/**
 * Does MAX hand us ids that a JavaScript number cannot hold? Run by hand, never by CI.
 *
 * One connection, INIT → LOGIN, nothing else — the login response already carries chats, contacts
 * and recent messages, so no further request is made and no write-shaped opcode is touched.
 *
 * **It prints shapes, never values.** No id, no title, no message and no token reaches the output:
 * this runs against a real personal account and a terminal is a place things get pasted from.
 *
 *   max session start   # once, the token goes to the OS keyring
 *   pnpm probe:ids
 *
 * It imports from `dist/`, not `src/`: Node's type stripping does not resolve a `.js` specifier
 * to a `.ts` file, so a script importing `../src/...js` dies on the first import. `pnpm probe:ids`
 * builds first for that reason.
 */

import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()

if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

/** Never let a message that quotes the request carry the token to the screen. */
const safe = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error)
  return text.split(token).join("<token>")
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/**
 * `decodeFrame` returns a bigint exactly when the integer would not survive as a number
 * (`narrow` in `src/protocol/frame.ts`), so "arrived as a bigint" is not a heuristic about digit counts —
 * it is the precise condition under which `Number(id)` loses digits.
 */
const shapeOf = (values: unknown[]) => {
  const digits = new Map<number, number>()
  let unsafe = 0
  for (const value of values) {
    if (typeof value === "bigint") unsafe += 1
    else if (typeof value !== "number") continue
    const length = String(value).replace("-", "").length
    digits.set(length, (digits.get(length) ?? 0) + 1)
  }
  const spread = [...digits.entries()].sort(([a], [b]) => a - b).map(([n, count]) => `${count}×${n}`)
  return { total: values.length, unsafe, spread: spread.join(", ") }
}

const collect = (rows: unknown, field: string): unknown[] =>
  (Array.isArray(rows) ? rows : []).map((row) => record(row)?.[field]).filter((id) => id !== undefined)

const connection = new Connection({ timeoutMs: 20_000 })
let unsafeTotal = 0

/**
 * `startSession` takes the caller's `invoke` rather than a socket, so that every request it makes
 * is built and checked like any other. A probe has no client to borrow one from, so it builds the
 * two payloads itself — which is all `MaxClient` does with it either.
 */
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

try {
  await connection.open()
  const login = await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const groups: [string, unknown[]][] = [
    ["chat ids", collect(login.chats, "id")],
    ["contact ids", collect(login.contacts, "id")],
    ["message ids", collect(login.messages, "id")],
    ["sender ids", collect(login.messages, "sender")],
  ]

  // PROTO-6: the specification declared this an array and MAX sends an object. Report the shape,
  // never the contents — one run of this answers what it actually is.
  const carried = login.messages
  console.log(
    `the login's \`messages\` field: ${
      carried === undefined
        ? "absent"
        : Array.isArray(carried)
          ? `an array of ${carried.length}`
          : typeof carried === "object" && carried !== null
            ? `an object with ${Object.keys(carried).length} key(s), first key looks like ${
                /^\d+$/.test(Object.keys(carried)[0] ?? "") ? "an id" : "a name"
              }`
            : typeof carried
    }\n`,
  )

  console.log("how many digits, and how many of those a number cannot hold:\n")
  for (const [name, values] of groups) {
    const { total, unsafe, spread } = shapeOf(values)
    unsafeTotal += unsafe
    console.log(
      `  ${name.padEnd(12)} ${String(total).padStart(4)} seen   digits: ${spread || "—"}   past 2^53: ${unsafe}`,
    )
  }

  console.log(
    unsafeTotal > 0
      ? `\nBUG-4 is live: ${unsafeTotal} id(s) here lose digits when sent back through Number().`
      : "\nBUG-4 is latent on this account: every id seen today survives a JavaScript number.",
  )
} catch (error) {
  console.error(`FAILED: ${safe(error)}`)
  process.exitCode = 1
} finally {
  await connection.close()
}
