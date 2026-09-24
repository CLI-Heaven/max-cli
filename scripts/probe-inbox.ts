/**
 * Is LOGIN's chat list the most recent chats, newest first? Run by hand, with the owner, never by CI.
 *
 *   pnpm probe:inbox
 *
 * `max inbox` without a cache has only what LOGIN returns — 40 chats by default. If those are not
 * the most recent, a chat with a new message can be missing from it and nothing would say so.
 * Authorised by the owner (`NEED-163`, «1 A»). Read only: INIT and LOGIN, nothing else.
 *
 * **It prints counts and booleans, never a value** — no id, no title, no time, no text.
 */
import { Connection } from "../dist/protocol/connection.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { sessionInit, sessionLogin } from "../dist/spec/operations/session.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}
const { deviceId } = store.readState()

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const timeOf = (chat: Record<string, unknown>): number | undefined => {
  const last = record(chat.lastMessage)
  const time = chat.lastEventTime ?? last?.time
  return typeof time === "number" ? time : undefined
}

const timesBy = new Map<number, number[]>()

for (const chatsCount of [40, 5]) {
  const connection = new Connection()
  try {
    await connection.open()
    await connection.invoke(sessionInit.opcode, buildRequest(sessionInit, { userAgent: WEB_USER_AGENT, deviceId }))
    const payload = await connection.invoke(
      sessionLogin.opcode,
      buildRequest(sessionLogin, {
        token,
        interactive: false,
        chatsCount,
        chatsSync: 0,
        contactsSync: 0,
        presenceSync: 0,
        draftsSync: 0,
      }),
    )
    const chats = (Array.isArray(payload.chats) ? payload.chats : []).map((chat) => record(chat) ?? {})
    const times = chats.map(timeOf)
    const known = times.filter((time): time is number => time !== undefined)
    const descending = known.every((time, index) => index === 0 || (known[index - 1] ?? time) >= time)
    const lastMessages = chats.filter((chat) => record(chat.lastMessage) !== undefined).length
    console.log(`chatsCount ${chatsCount}: ${chats.length} chat(s) back`)
    console.log(`   with a time: ${known.length}; newest first: ${descending ? "yes" : "no"}`)
    console.log(`   carrying lastMessage: ${lastMessages}`)
    timesBy.set(chatsCount, known)
  } finally {
    await connection.close()
  }
}

const newest = (timesBy.get(40) ?? []).toSorted((a, b) => b - a)
const five = (timesBy.get(5) ?? []).toSorted((a, b) => b - a)
const same = five.every((time, index) => time === newest[index])
console.log(`chatsCount 5 returned the newest ${five.length} of the full list: ${same ? "yes" : "no"}`)
