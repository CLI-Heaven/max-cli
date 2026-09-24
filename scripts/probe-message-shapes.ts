/**
 * What do `elements` (text markup), `link` (reply or forward) and opcode 180 (a message's reactions)
 * look like? Run by hand, never by CI.
 *
 *   pnpm probe:message-shapes [chats=20] [messages=50]
 *
 * PyMax and tsmax claim: `elements` is `[{type, from, length, attributes?: {url}}]` with types
 * STRONG, EMPHASIZED, UNDERLINE, STRIKETHROUGH, MONOSPACED, CODE, LINK; a reply is
 * `link: {type: "REPLY", messageId}`; `MSG_GET_REACTIONS` (180) takes `{chatId, messageIds}` and
 * answers `{messagesReactions: {<id>: {totalCount, counters: [{reaction, count}], yourReaction}}}`.
 * This reads received messages and asks 180 about Saved messages (chat 0) to check the claims.
 *
 * **It prints no content**: key names, value types, and only the values of `type` fields and of
 * reaction codes. Numeric keys (message ids) print as `<id>`. It never sends 178 or 179, which add
 * and remove a reaction. Reading history never marks read.
 */

import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const MSG_GET_REACTIONS = 180

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

const typeOf = (value: unknown): string => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value)

/** An upper-case code or an emoji-sized string with no letter or digit — never a name or a sentence. */
const label = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value === "") return undefined
  if (/^[A-Z_]{1,24}$/.test(value)) return value
  return [...value].length <= 8 && !/[\p{L}\d]/u.test(value) ? value : undefined
}

const PRIVATE = new Set(["text", "name", "title", "url", "baseUrl", "description", "phone", "link"])

const shapes = new Map<string, Set<string>>()
const labels = new Map<string, Map<string, number>>()

const note = (path: string, value: unknown, printLabel: boolean): void => {
  const types = shapes.get(path) ?? new Set()
  types.add(typeOf(value))
  shapes.set(path, types)
  const shown = printLabel ? label(value) : undefined
  if (shown) {
    const seen = labels.get(path) ?? new Map()
    seen.set(shown, (seen.get(shown) ?? 0) + 1)
    labels.set(path, seen)
  }
}

/** Types everywhere; labels only on `type` and reaction fields; nothing under a private key. */
const walk = (value: unknown, path: string, key = ""): void => {
  note(path, value, key === "type" || key === "reaction" || key === "yourReaction")
  if (PRIVATE.has(key) && path !== "message.link") return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${path}[]`)
    return
  }
  const object = record(value)
  if (!object) return
  for (const [inner, child] of Object.entries(object)) {
    const name = /^-?\d+$/.test(inner) ? "<id>" : inner
    walk(child, `${path}.${name}`, inner)
  }
}

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

const history = async (chatId: string): Promise<Record<string, unknown>[]> => {
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
      interactive: false,
    }),
  )
  return (Array.isArray(answer.messages) ? answer.messages : []).map(record).filter((m) => m !== undefined)
}

try {
  await connection.open()
  const login = await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })
  const chats = (Array.isArray(login.chats) ? login.chats : []).map(record).filter((chat) => chat !== undefined)
  const ids = chats.slice(0, chatLimit).map((chat) => asId(chat.id))
  const chatIds = ["0", ...ids.filter((id): id is string => id !== undefined && id !== "0")]

  let messages = 0
  let withElements = 0
  let withLink = 0
  let saved: Record<string, unknown>[] = []
  for (const chatId of chatIds) {
    const read = await history(chatId)
    if (chatId === "0") saved = read
    for (const message of read) {
      messages += 1
      if (Array.isArray(message.elements) && message.elements.length > 0) {
        withElements += 1
        walk(message.elements, "message.elements", "elements")
      }
      if (record(message.link)) {
        withLink += 1
        walk(message.link, "message.link", "link")
      }
    }
  }

  const savedIds = saved.map((message) => asId(message.id)).filter((id): id is string => id !== undefined)
  const reactions = savedIds.length
    ? record(await connection.invoke(MSG_GET_REACTIONS, { chatId: 0n, messageIds: savedIds.map((id) => BigInt(id)) }))
    : undefined
  if (reactions) walk(reactions, "reactions(180)")
  const perMessage = record(reactions?.messagesReactions)

  console.log(
    `read ${chatIds.length} chats, ${messages} messages: ${withElements} with elements, ${withLink} with link`,
  )
  console.log(
    `opcode 180 on Saved messages: asked about ${savedIds.length}, answered for ${perMessage ? Object.keys(perMessage).length : "none"}\n`,
  )
  console.log("paths — value types — labels seen")
  for (const [path, types] of [...shapes].sort(([a], [b]) => a.localeCompare(b))) {
    const seen = labels.get(path)
    const shown = seen ? `  ${[...seen].map(([value, count]) => `${value} ×${count}`).join("  ")}` : ""
    console.log(`  ${path}: ${[...types].join(" | ")}${shown}`)
  }
} finally {
  await connection.close()
}
