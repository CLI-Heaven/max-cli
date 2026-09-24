/**
 * Does a poll work the way the web client's code says? Run by hand, never by CI.
 *
 *   pnpm probe:polls
 *
 * **Writes to the Saved-messages dialog (chat 0) and nowhere else** (`NEED-242`): one poll created,
 * voted in, the vote taken back, the poll closed. The shapes are web.max.ru's (`FIND-140`) and
 * PyMax's. Printed: field names, numbers and this script's own test text. Opens no cache. The poll
 * stays; the owner removes it by hand (`NEED-32`).
 */

import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const MULTIPLE = 2
const REVOTE = 4
const CLOSED = 8

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

type Json = Record<string, unknown>
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {}
const keys = (value: unknown) => Object.keys(record(value)).sort().join(",")
const reason = (error: unknown) =>
  String(record((error as { payload?: unknown }).payload).error ?? (error as Error).message)

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

const step = async (label: string, run: () => Promise<Json>): Promise<Json | undefined> => {
  try {
    const answer = await run()
    console.log(`${label}: ok, answer keys=${keys(answer)}`)
    return answer
  } catch (error) {
    console.log(`${label}: refused ${reason(error)}`)
    return undefined
  }
}

/** The shape of a poll attachment: settings, version, answer ids and counts — no text but ours. */
const describe = (label: string, attach: Json | undefined) => {
  if (!attach) return console.log(`${label}: no POLL attachment`)
  const state = record(attach.state)
  const results = (Array.isArray(state.result) ? state.result : []).map(record)
  console.log(`${label}: keys=${keys(attach)} settings=${String(attach.settings)} version=${String(attach.version)}`)
  console.log(`  state keys=${keys(state)} total=${String(state.total)}`)
  for (const result of results) {
    console.log(
      `  answer ${String(asId(result.answerId))}: voteCount=${String(result.voteCount)} options=${String(result.options)}`,
    )
  }
}

const readPoll = async (messageId: string): Promise<Json | undefined> => {
  const history = await connection.invoke(
    chatsHistory.opcode,
    buildRequest(chatsHistory, {
      chatId: "0",
      from: Date.now() + 60_000,
      forward: 0,
      backward: 10,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
      interactive: false,
    }),
  )
  const message = (Array.isArray(history.messages) ? history.messages : [])
    .map(record)
    .find((each) => asId(each.id) === messageId)
  return (Array.isArray(message?.attaches) ? message.attaches : []).map(record).find((each) => each._type === "POLL")
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const created = await step("create (64) in chat 0", () =>
    connection.invoke(64, {
      chatId: 0n,
      message: {
        cid: Date.now(),
        text: "",
        attaches: [
          {
            _type: "POLL",
            title: `max-cli probe: poll ${new Date().toISOString()}`,
            answers: [{ text: "one" }, { text: "two" }],
            settings: REVOTE | MULTIPLE,
          },
        ],
      },
      notify: true,
    }),
  )
  const message = record(created?.message)
  const messageId = asId(message.id)
  const chatId = BigInt(String(asId(created?.chatId ?? message.chatId) ?? "0"))
  console.log(`  send answer names a chat other than 0: ${chatId !== 0n}`)
  if (!messageId) throw new Error("no message id in the send answer")

  const poll = await readPoll(messageId)
  describe("read back", poll)
  const pollId = asId(poll?.pollId)
  const answerIds = (Array.isArray(poll?.answers) ? poll.answers : []).map((each) => asId(record(each).answerId))
  if (!pollId || !answerIds[0]) throw new Error("no pollId or answer ids to vote with")

  const vote = await step("vote (304) for the first answer", () =>
    connection.invoke(304, {
      chatId,
      messageId: BigInt(messageId),
      pollId: BigInt(pollId),
      answersIds: [BigInt(String(answerIds[0]))],
    }),
  )
  describe("vote answer", { ...record(vote), _type: "POLL" })
  describe("read back after vote", await readPoll(messageId))

  await step("take back (304) with no answers", () =>
    connection.invoke(304, { chatId, messageId: BigInt(messageId), pollId: BigInt(pollId), answersIds: [] }),
  )
  describe("read back after take back", await readPoll(messageId))

  const closed = await step("close (67) with the closed bit", () =>
    connection.invoke(67, {
      chatId,
      messageId: BigInt(messageId),
      attachments: [
        {
          _type: "POLL",
          pollId: BigInt(pollId),
          title: poll?.title,
          answers: (Array.isArray(poll?.answers) ? poll.answers : []).map((each) => ({ text: record(each).text })),
          settings: (typeof poll?.settings === "number" ? poll.settings : 0) | CLOSED,
        },
      ],
    }),
  )
  console.log(
    `  closed bit in the edit answer: ${
      ((record((record(closed?.message).attaches as unknown[] | undefined)?.[0]).settings as number) & CLOSED) !== 0
    }`,
  )
  describe("read back after close", await readPoll(messageId))
  console.log(`poll message id: ${messageId} — remove it by hand, or with max messages delete once it exists`)
} finally {
  await connection.close()
}
