/**
 * What does an attachment look like on the wire? Run by hand, never by CI.
 *
 *   pnpm probe:attachments <chat-id>
 *
 * The domain model kept only `_type`, and nothing in this repository had measured the rest — the
 * shapes other clients declare are claims. **It prints no content**: per attachment kind, the field
 * names, the type of each value, and whether a string is an `https` link. Never a value.
 * Reading history never marks anything read.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const chatId = process.argv[2]
if (!chatId || !/^-?\d+$/.test(chatId)) {
  console.error("usage: pnpm probe:attachments <chat-id>")
  process.exit(2)
}

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const describe = (value: unknown): string => {
  if (typeof value === "string") return /^https:\/\//.test(value) ? "https-link" : "string"
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const answer = await connection.invoke(
    chatsHistory.opcode,
    buildRequest(chatsHistory, {
      chatId,
      from: Date.now(),
      forward: 0,
      backward: Number(process.argv[3] ?? 50),
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
    }),
  )

  let photoLink: string | undefined
  const messageFields = new Map<string, Set<string>>()
  const links = new Map<string, Map<string, Set<string>>>()
  const kinds = new Map<string, { count: number; fields: Map<string, Set<string>> }>()
  for (const message of Array.isArray(answer.messages) ? answer.messages : []) {
    const entry0 = record(message) ?? {}
    for (const [key, value] of Object.entries(entry0)) {
      const types = messageFields.get(key) ?? new Set()
      types.add(describe(value))
      messageFields.set(key, types)
    }
    const link = record(entry0.link)
    if (link) {
      const type = typeof link.type === "string" ? link.type : "unknown"
      const fields = links.get(type) ?? new Map()
      for (const [key, value] of Object.entries(link)) {
        const types = fields.get(key) ?? new Set()
        types.add(
          key === "message"
            ? `object{${Object.keys(record(value) ?? {})
                .sort()
                .join(",")}}`
            : describe(value),
        )
        fields.set(key, types)
      }
      links.set(type, fields)
    }
    const attaches = entry0.attaches
    for (const attach of Array.isArray(attaches) ? attaches : []) {
      const entry = record(attach)
      if (!entry) continue
      const kind = typeof entry._type === "string" ? entry._type : "unknown"
      if (kind === "PHOTO" && typeof entry.baseUrl === "string") photoLink ??= entry.baseUrl
      const seen = kinds.get(kind) ?? { count: 0, fields: new Map() }
      seen.count += 1
      for (const [key, value] of Object.entries(entry)) {
        const types = seen.fields.get(key) ?? new Set()
        types.add(describe(value))
        seen.fields.set(key, types)
      }
      kinds.set(kind, seen)
    }
  }

  console.log(`attachments in the last 50 messages — field names and value types only:\n`)
  if (kinds.size === 0) console.log("  none")
  for (const [kind, { count, fields }] of kinds) {
    console.log(`  ${kind} ×${count}`)
    for (const [key, types] of [...fields].sort(([a], [b]) => a.localeCompare(b)))
      console.log(`    ${key}: ${[...types].join(" | ")}`)
  }

  console.log("\nmessage fields:")
  for (const [key, types] of [...messageFields].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`    ${key}: ${[...types].join(" | ")}`)
  console.log("\nlink kinds:")
  if (links.size === 0) console.log("  none")
  for (const [type, fields] of links) {
    console.log(`  ${type}`)
    for (const [key, types] of fields) console.log(`    ${key}: ${[...types].join(" | ")}`)
  }

  if (photoLink) {
    // No cookie and no token: whether the link alone is enough is the question.
    const response = await fetch(photoLink, {
      headers: { "User-Agent": WEB_USER_AGENT.headerUserAgent, Referer: "https://web.max.ru/" },
    })
    await response.body?.cancel()
    console.log(
      `\n  first photo link, fetched without credentials: ${response.status} ${response.headers.get("content-type")}`,
    )
  }
} finally {
  await connection.close()
}
