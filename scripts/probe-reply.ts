/**
 * Does MSG_SEND take a reply and markup, and how is a reaction sent? Run by hand, never by CI.
 *
 *   pnpm probe:reply
 *
 * **Writes to the Saved-messages dialog (chat 0) and nowhere else** (`NEED-28`, `NEED-150`): a base
 * message, a reply to it with one bold word, and a 👍 on the base. The shapes are the ones tsmax and
 * PyMax send; reading the messages back is what turns their claim into a measurement. Everything
 * printed is this script's own test text or a field name. The test messages stay; the owner removes
 * them by hand (`NEED-32`).
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const SAVED = 0
const REACTION = 178
const GET_REACTIONS = 180

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) => (typeof inner === "bigint" ? `${inner}n` : inner))

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

let cid = Date.now()
const send = async (text: string, extra: Record<string, unknown> = {}) => {
  cid += 1
  const answer = await connection.invoke(64, {
    chatId: SAVED,
    message: { text, cid, elements: [], attaches: [], ...extra },
    notify: true,
  })
  const id = asId(record(answer.message).id)
  if (!id) throw new Error(`no message id in the answer: ${Object.keys(answer).join(",")}`)
  return id
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const base = await send("max-cli probe: base")
  const text = "max-cli probe: reply bold"
  const bold = { type: "STRONG", from: text.indexOf("bold"), length: "bold".length }
  const reply = await send(text, { elements: [bold], link: { type: "REPLY", messageId: BigInt(base) } })
  console.log(`sent base ${base}, reply ${reply}`)

  const reacted = await connection.invoke(REACTION, {
    chatId: SAVED,
    messageId: BigInt(base),
    reaction: { reactionType: "EMOJI", id: "👍" },
  })
  console.log(`\nreaction (178) answered: ${shape(reacted)}`)

  const history = await connection.invoke(
    chatsHistory.opcode,
    buildRequest(chatsHistory, {
      chatId: String(SAVED),
      from: Date.now() + 60_000,
      forward: 0,
      backward: 5,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
      interactive: false,
    }),
  )
  for (const message of (Array.isArray(history.messages) ? history.messages : []).map(record)) {
    const id = asId(message.id)
    if (id !== base && id !== reply) continue
    const link = record(message.link)
    console.log(`\n${id === base ? "base" : "reply"} read back:`)
    console.log(`  fields: ${Object.keys(message).sort().join(", ")}`)
    console.log(`  elements: ${shape(message.elements ?? null)}`)
    if (message.link) console.log(`  link: type=${shape(link.type)} keys=${Object.keys(link).sort().join(",")}`)
    if (message.link) console.log(`  link points at base: ${asId(link.messageId ?? record(link.message).id) === base}`)
    if (message.reactionInfo) console.log(`  reactionInfo: ${shape(message.reactionInfo)}`)
  }

  const reactions = await connection.invoke(GET_REACTIONS, { chatId: SAVED, messageIds: [BigInt(base)] })
  console.log(`\nreactions read (180): ${shape(reactions)}`)
} finally {
  await connection.close()
}
