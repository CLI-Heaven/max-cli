/**
 * Does LOGIN tell how many messages a chat holds? Run by hand, never by CI.
 *
 *   pnpm probe:message-count
 *
 * One login, then one `CHAT_HISTORY` (49) with `interactive: false` on the smallest chat that
 * claims a count, to see whether the claim matches what history returns. Reads only; nothing is
 * marked read. Decides whether `max backup messages` estimates exactly or by density (`CLI-34`).
 *
 * Printed: field names, chat types and numbers — never a title, a text, a name or an id.
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

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const number = (value: unknown) => (typeof value === "number" || typeof value === "bigint" ? Number(value) : undefined)

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

try {
  await connection.open()
  const login = record(await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 }))
  const chats = (Array.isArray(login.chats) ? login.chats : []).map(record)

  const fields = new Map<string, number>()
  for (const chat of chats) for (const key of Object.keys(chat)) fields.set(key, (fields.get(key) ?? 0) + 1)
  console.log(`${chats.length} chats; fields and how many chats carry each:`)
  console.log(
    [...fields]
      .sort()
      .map(([key, n]) => `  ${key}: ${n}`)
      .join("\n"),
  )

  const rows = chats.map((chat) => ({
    chat,
    type: String(chat.type),
    count: number(chat.messagesCount),
    created: number(chat.created),
    joinTime: number(chat.joinTime),
  }))
  const day = (ms: number | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—")
  console.log("\ntype, messagesCount, created, joinTime:")
  for (const row of rows) console.log(`  ${row.type} ${row.count ?? "—"} ${day(row.created)} ${day(row.joinTime)}`)

  const small = rows
    .filter((row) => row.count !== undefined && row.count > 0 && row.count < 150)
    .sort((a, b) => (a.count ?? 0) - (b.count ?? 0))
    .at(-1)
  if (!small) {
    console.log("\nno chat claims a count under 150 — nothing to compare against")
  } else {
    const answer = record(
      await connection.invoke(49, {
        chatId: small.chat.id,
        from: Date.now(),
        forward: 0,
        backward: 200,
        forwardTime: 0,
        backwardTime: 0,
        itemType: "REGULAR",
        getChat: false,
        getMessages: true,
        interactive: false,
      }),
    )
    const returned = Array.isArray(answer.messages) ? answer.messages.length : "absent"
    console.log(`\n${small.type} claiming ${small.count}: history from now, backward 200, returned ${returned}`)
  }
} finally {
  await connection.close()
}
