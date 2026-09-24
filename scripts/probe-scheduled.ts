/**
 * Does MAX take a scheduled message from us, and where does it wait? Run by hand, never by CI.
 *
 *   pnpm probe:scheduled            # schedules one message two minutes ahead, reads the queue
 *   pnpm probe:scheduled check      # after that: is it in the history, is the queue empty
 *
 * **Writes to the Saved-messages dialog (chat 0) and nowhere else** (`NEED-163`): one message with
 * `delayedAttributes.timeToFire`, the shape the web client sends (`FIND-78`). Printed: field names,
 * times relative to now, and this script's own text. The message stays; the owner removes it.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"

const SAVED = 0
const TEXT = "max-cli probe: scheduled"

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

const ago = (ms: unknown): string =>
  typeof ms === "number" ? `${Math.round((ms - Date.now()) / 1000)} s from now` : `not a number: ${shape(ms)}`

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

const read = async (itemType: "REGULAR" | "DELAYED") => {
  const request =
    itemType === "DELAYED"
      ? { chatId: SAVED, from: 1, forward: 20, backward: 0, forwardTime: 0, backwardTime: 0 }
      : { chatId: SAVED, from: Date.now() + 60_000, forward: 0, backward: 10, forwardTime: 0, backwardTime: 0 }
  const answer = await connection.invoke(49, {
    ...request,
    itemType,
    getChat: false,
    getMessages: true,
    interactive: false,
  })
  return (Array.isArray(answer.messages) ? answer.messages : [])
    .map(record)
    .filter((message) => String(message.text ?? "").startsWith(TEXT))
}

const describe = (label: string, messages: Record<string, unknown>[]) => {
  console.log(`\n${label}: ${messages.length} of ours`)
  for (const message of messages) {
    console.log(`  id ${asId(message.id)} · time ${ago(message.time)} · status ${shape(message.status ?? null)}`)
    console.log(`  fields: ${Object.keys(message).sort().join(", ")}`)
    if (message.delayedAttributes) console.log(`  delayedAttributes: ${shape(message.delayedAttributes)}`)
  }
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  if (process.argv[2] === "check") {
    describe("queue (DELAYED)", await read("DELAYED"))
    describe("history (REGULAR)", await read("REGULAR"))
  } else {
    const fire = Date.now() + 120_000
    const text = `${TEXT} for ${new Date(fire).toISOString()}`
    const answer = await connection.invoke(64, {
      chatId: SAVED,
      message: { text, cid: Date.now(), elements: [], attaches: [], delayedAttributes: { timeToFire: fire } },
      notify: true,
    })
    const message = record(answer.message)
    console.log(`asked for timeToFire ${ago(fire)}`)
    console.log(`answer fields: ${Object.keys(answer).sort().join(", ")}`)
    console.log(`message fields: ${Object.keys(message).sort().join(", ")}`)
    console.log(`message id ${asId(message.id)} · time ${ago(message.time)} · status ${shape(message.status ?? null)}`)
    if (message.delayedAttributes) console.log(`delayedAttributes: ${shape(message.delayedAttributes)}`)
    describe("queue (DELAYED)", await read("DELAYED"))
    describe("history (REGULAR)", await read("REGULAR"))
  }
} finally {
  await connection.close()
}
