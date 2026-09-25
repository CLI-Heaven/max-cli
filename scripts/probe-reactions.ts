/**
 * Does a history message carry its reactions, and in what shape? Run by hand, never by CI.
 *
 *   pnpm probe:reactions [chats=20] [messages=50]
 *
 * The backlog said every message carries `reactionInfo`; that came from a synthetic test fixture,
 * never a capture. **It prints no content**: every top-level message field with its value type and
 * how often it appears, the shape of any field whose name mentions a reaction, and short values
 * that can only be an emoji (no letter, no digit) or an upper-case code. Never a message, a name,
 * an id or a timestamp.
 *
 * It reads the chats LOGIN returns with CHAT_HISTORY only. Reading history never marks read.
 *
 * Measured 2026-09-23 (`100 200`): LOGIN returned 25 chats — 17 dialogs, 4 groups, 4 channels.
 * 1,101 messages, and **no field whose name mentions a reaction, not even an empty one**. The
 * fields seen: `attaches` array, `cid` number, `elements` array, `id` string, `link` object,
 * `options` number, `sender` number, `status` string, `text` string, `time` number, `type`
 * string, `updateTime` number.
 *
 * Re-measured 2026-09-23 (`30 50`) after the owner reacted to a message in Saved messages, with chat
 * 0 read explicitly: still no reaction field on any of 653 messages. **History does not carry
 * reactions**; a client must fetch them with another request, not identified yet.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const chatLimit = Number(process.argv[2] ?? 20)
const messageLimit = Number(process.argv[3] ?? 50)

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

/** An emoji (no letter, no digit) or an upper-case code — never an id, a name or a sentence. */
const enumLike = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value === "") return undefined
  if ([...value].length <= 8 && !/[\p{L}\d]/u.test(value)) return value
  return /^[A-Z_]{1,24}$/.test(value) ? value : undefined
}

const messageKeys = new Map<string, { count: number; types: Set<string> }>()
const shapes = new Map<string, Set<string>>()
const values = new Map<string, Map<string, number>>()

const walk = (value: unknown, path: string): void => {
  const types = shapes.get(path) ?? new Set()
  types.add(typeOf(value))
  shapes.set(path, types)
  const printable = enumLike(value)
  if (printable) {
    const seen = values.get(path) ?? new Map()
    seen.set(printable, (seen.get(printable) ?? 0) + 1)
    values.set(path, seen)
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${path}[]`)
    return
  }
  const object = record(value)
  if (object) for (const [key, inner] of Object.entries(object)) walk(inner, `${path}.${key}`)
}

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) ? value.length === 0 : Object.keys(record(value) ?? { x: 1 }).length === 0)

let scanned = 0
let withReactions = 0
let chatsWithReactions = 0

const scan = (messages: unknown[]): boolean => {
  let found = false
  for (const message of messages) {
    const entry = record(message)
    if (!entry) continue
    scanned += 1
    let has = false
    for (const [key, value] of Object.entries(entry)) {
      const seen = messageKeys.get(key) ?? { count: 0, types: new Set() }
      seen.count += 1
      seen.types.add(typeOf(value))
      messageKeys.set(key, seen)
      if (!/reaction/i.test(key)) continue
      walk(value, key)
      if (!isEmpty(value)) has = true
    }
    if (has) {
      withReactions += 1
      found = true
    }
  }
  return found
}

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

try {
  await connection.open()
  const login = await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })
  const chats = (Array.isArray(login.chats) ? login.chats : []).map(record).filter((chat) => chat !== undefined)

  const lastMessages = chats.map((chat) => chat.lastMessage).filter((message) => message !== undefined)
  scan(lastMessages)
  const fromLogin = { scanned, withReactions }
  scanned = 0
  withReactions = 0

  let read = 0
  const kinds = new Map<string, number>()
  // Saved messages (chat 0) is where the owner reacts for this probe, and LOGIN need not list it.
  const ids = chats.slice(0, chatLimit).map((chat) => asId(chat.id))
  const chatIds = ["0", ...ids.filter((id): id is string => id !== undefined && id !== "0")]
  let savedRead = false
  for (const chatId of chatIds) {
    const answer = await connection.invoke(
      chatsHistory.opcode,
      buildRequest(chatsHistory, {
        chatId,
        from: Date.now(),
        forward: 0,
        backward: messageLimit,
        forwardTime: 0,
        backwardTime: 0,
        itemType: "REGULAR",
        getChat: false,
        getMessages: true,
      }),
    )
    read += 1
    const messages = Array.isArray(answer.messages) ? answer.messages : []
    if (chatId === "0") savedRead = messages.length > 0
    const chat = chats.find((candidate) => asId(candidate.id) === chatId)
    const kind = chatId === "0" ? "SAVED" : typeof chat?.type === "string" ? chat.type : "unknown"
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
    if (scan(messages)) chatsWithReactions += 1
  }

  console.log(`LOGIN lastMessage: ${fromLogin.withReactions} of ${fromLogin.scanned} carry a non-empty reaction field`)
  console.log(`history: ${read} chats read, ${scanned} messages, ${withReactions} with a non-empty reaction field`)
  console.log(`         in ${chatsWithReactions} chats; Saved messages read: ${savedRead ? "yes" : "no or empty"}`)
  console.log(`chats read by kind: ${[...kinds].map(([kind, count]) => `${kind} ×${count}`).join("  ")}\n`)
  console.log("every top-level message field, with how many messages carry it")
  for (const [key, { count, types }] of [...messageKeys].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`  ${key} ×${count}: ${[...types].join(" | ")}`)
  console.log("\nreaction fields — path: value types")
  if (shapes.size === 0) console.log("  none")
  for (const [path, types] of [...shapes].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`  ${path}: ${[...types].join(" | ")}`)
  console.log("\nshort non-numeric string values seen, with counts")
  if (values.size === 0) console.log("  none")
  for (const [path, seen] of values)
    console.log(`  ${path}: ${[...seen].map(([value, count]) => `${value} ×${count}`).join("  ")}`)
} finally {
  await connection.close()
}
