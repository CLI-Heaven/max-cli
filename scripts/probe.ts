/**
 * A live check against the real MAX, run by hand and never by CI.
 *
 * It opens one connection, does INIT → LOGIN → CHATS_LIST, prints **counts only**, and closes.
 * No chat title, no message, no id and no token reaches the output: this runs against a real
 * personal account, and a terminal is a place secrets get pasted from.
 *
 *   MAX_TOKEN="$(cat /path/to/token)" MAX_DEVICE_ID=<uuid> node --experimental-strip-types scripts/probe.ts
 */
import { randomUUID } from "node:crypto"
import { Connection } from "../src/protocol/connection.js"
import { Opcode, startSession } from "../src/protocol/session.js"

const token = process.env.MAX_TOKEN
if (!token) {
  console.error("set MAX_TOKEN (read it from a file; do not type it on the command line)")
  process.exit(2)
}

const deviceId = process.env.MAX_DEVICE_ID ?? randomUUID()
const connection = new Connection({ timeoutMs: 20_000 })
const started = Date.now()

try {
  await connection.open()
  console.log(`connected in ${Date.now() - started}ms`)

  const login = await startSession(connection, { token, deviceId, chatsCount: 5 })
  const chats = Array.isArray(login.chats) ? login.chats : []
  const profile = login.profile as { contact?: { names?: unknown[] } } | undefined

  console.log(`login ok: profile ${profile ? "present" : "absent"}, ${chats.length} chats in the login response`)
  console.log(`login payload keys: ${Object.keys(login).sort().join(", ")}`)

  const listed = await connection.invoke(Opcode.CHATS_LIST, { marker: Date.now(), count: 5 })
  const listedChats = Array.isArray(listed.chats) ? listed.chats : []
  console.log(`chats.list ok: ${listedChats.length} chats`)

  const first = listedChats[0] as Record<string, unknown> | undefined
  if (first) console.log(`a chat carries these fields: ${Object.keys(first).sort().join(", ")}`)

  const me = await connection.invoke(Opcode.PROFILE, {})
  console.log(`profile ok: keys ${Object.keys(me).sort().join(", ")}`)
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await connection.close()
  console.log("closed")
}
