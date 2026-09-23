/**
 * Where does a file's or a video's link come from? Run by hand, never by CI.
 *
 *   pnpm probe:download <chat-id>
 *
 * A FILE or VIDEO attachment carries an id and no link (measured 2026-09-23). This asks MAX for the
 * link of the first one of each in the chat's last 200 messages, prints the answer's field names and
 * value types, then fetches the link without credentials and prints only status, type and length.
 * Never a value, never a byte of the file.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { attachmentsFile, attachmentsVideo } from "../dist/spec/operations/attachments.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const chatId = process.argv[2]
if (!chatId || !/^-?\d+$/.test(chatId)) {
  console.error("usage: pnpm probe:download <chat-id>")
  process.exit(2)
}

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const describe = (value: unknown): string => {
  if (typeof value === "string") return /^https:\/\//.test(value) ? "https-link" : "string"
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

const fetchHead = async (link: string) => {
  const response = await fetch(link, {
    headers: { "User-Agent": WEB_USER_AGENT.headerUserAgent, Referer: "https://web.max.ru/" },
  })
  await response.body?.cancel()
  console.log(
    `    fetched without credentials: ${response.status} ${response.headers.get("content-type")} ` +
      `length=${response.headers.get("content-length")} disposition=${response.headers.has("content-disposition")}`,
  )
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const history = await connection.invoke(
    chatsHistory.opcode,
    buildRequest(chatsHistory, {
      chatId,
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

  const wanted = [
    { kind: "FILE", idField: "fileId", operation: attachmentsFile },
    { kind: "VIDEO", idField: "videoId", operation: attachmentsVideo },
  ] as const
  for (const { kind, idField, operation } of wanted) {
    const messages = Array.isArray(history.messages) ? history.messages : []
    const message = messages
      .map(record)
      .find((m) => (Array.isArray(m.attaches) ? m.attaches : []).some((a) => record(a)._type === kind))
    if (!message) {
      console.log(`${kind}: none in the last 200 messages`)
      continue
    }
    const attach = record((message.attaches as unknown[]).find((a) => record(a)._type === kind))
    const answer = await connection.invoke(
      operation.opcode,
      buildRequest(operation, { chatId, messageId: String(message.id), [idField]: String(attach[idField]) } as never),
    )
    console.log(`${kind} → opcode ${operation.opcode}:`)
    for (const [key, value] of Object.entries(record(answer)).sort(([a], [b]) => a.localeCompare(b)))
      console.log(`    ${key}: ${describe(value)}`)
    const link = Object.values(record(answer)).find(
      (value) => typeof value === "string" && value.startsWith("https://"),
    )
    if (typeof link === "string") await fetchHead(link)
  }
} finally {
  await connection.close()
}
