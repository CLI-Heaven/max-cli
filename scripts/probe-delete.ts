/**
 * What does MAX answer to a deletion, and does the message go? Run by hand, never by CI.
 *
 *   pnpm probe:delete
 *
 * **Writes to the Saved-messages dialog (chat 0) and nowhere else** (`NEED-150`, `NEED-241`): two test
 * messages, the first deleted with `forMe: true`, the second with `forMe: false`. Printed: the
 * answer's keys and scalar values, the opcodes MAX pushed meanwhile, and whether each message is
 * still in history. No text but this script's own.
 *
 * Uses the session of whatever `MAX_STATE_DIR` and `MAX_CONFIG_DIR` point at, so a worktree runs it
 * with the variables `bin/max` sets; it opens no cache.
 */

import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"
import { messagesDelete } from "../dist/spec/operations/messages.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

type Json = Record<string, unknown>
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {}
const reason = (error: unknown) =>
  String(record((error as { payload?: unknown }).payload).error ?? (error as Error).message)
const shape = (value: unknown): string =>
  Object.entries(record(value))
    .map(([key, inner]) => (typeof inner === "object" && inner !== null ? `${key}:{…}` : `${key}=${String(inner)}`))
    .join(" ") || "{}"

const pushed: number[] = []
const connection = new Connection({ timeoutMs: 20_000, onEvent: (frame) => pushed.push(frame.opcode) })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

let cid = Date.now()
const send = async (text: string): Promise<{ id: string; chatId: string }> => {
  cid += 1
  const answer = await connection.invoke(64, { chatId: 0n, message: { cid, text, attaches: [] }, notify: true })
  const id = asId(record(answer.message).id)
  if (!id) throw new Error("no message id in the send answer")
  return { id, chatId: String(asId(answer.chatId ?? record(answer.message).chatId) ?? "0") }
}

const stillThere = async (id: string): Promise<boolean> => {
  const history = await invoke(chatsHistory, {
    chatId: "0",
    from: Date.now() + 60_000,
    forward: 0,
    backward: 20,
    forwardTime: 0,
    backwardTime: 0,
    itemType: "REGULAR",
    getChat: false,
    getMessages: true,
    interactive: false,
  })
  return (Array.isArray(history.messages) ? history.messages : []).some((message) => asId(record(message).id) === id)
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 20 })

  for (const forMe of [true, false]) {
    const { id, chatId } = await send(`max-cli probe: delete forMe=${forMe}`)
    console.log(
      `sent to chat 0 (answer names chat ${chatId === "0" ? "0" : "by its own id"}); in history: ${await stillThere(id)}`,
    )
    pushed.length = 0
    for (const target of chatId === "0" ? ["0"] : ["0", chatId]) {
      try {
        const answer = await invoke(messagesDelete, { chatId: target, messageIds: [id], forMe })
        console.log(`delete forMe=${forMe} via chat ${target === "0" ? "0" : "own id"}: ok, answer ${shape(answer)}`)
        break
      } catch (error) {
        console.log(`delete forMe=${forMe} via chat ${target === "0" ? "0" : "own id"}: refused ${reason(error)}`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
    console.log(`  pushed meanwhile: ${pushed.join(",") || "nothing"}; still in history: ${await stillThere(id)}`)
  }
} catch (error) {
  console.error(`probe failed: ${reason(error)}`)
  process.exitCode = 1
} finally {
  await connection.close()
}
