/**
 * Does MAX mark an edited message, and how does a deleted one behave? Run by hand, never by CI.
 *
 *   max session start        # once, if there is no session yet
 *   pnpm probe:edits
 *
 * The documentation claims an edited message gains `status: "EDITED"` and an `updateTime` distinct
 * from `time` (`max-api-docs/protocol/messaging.md:357-368`). The whole change-detection design of
 * the cache rests on that, and a claim is not a measurement.
 *
 * **It reads one chat and prints no content.** Field names, counts, and the small enum values of
 * `status` — never a message, a name, an id or a timestamp. Chat 0 is the owner's Saved-messages
 * dialog, the only chat safe to read for this (`NEED-28`), and reading never marks anything read.
 */
import { Connection } from "../dist/protocol/connection.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()

if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const connection = new Connection({ timeoutMs: 20_000 })

try {
  await connection.open()
  await startSession(connection, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const answer = await connection.invoke(
    chatsHistory.opcode,
    buildRequest(chatsHistory, {
      chatId: "0",
      from: Date.now(),
      forward: 0,
      backward: 20,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
      interactive: false,
    }),
  )

  const messages = (Array.isArray(answer.messages) ? answer.messages : [])
    .map(record)
    .filter((message): message is Record<string, unknown> => message !== undefined)

  const fields = new Set<string>()
  const statuses = new Map<string, number>()
  let withUpdateTime = 0
  let updatedAfterSent = 0

  for (const message of messages) {
    for (const key of Object.keys(message)) fields.add(key)

    const status = typeof message.status === "string" ? message.status : undefined
    if (status) statuses.set(status, (statuses.get(status) ?? 0) + 1)

    if (message.updateTime !== undefined) {
      withUpdateTime += 1
      if (Number(message.updateTime) > Number(message.time)) updatedAfterSent += 1
    }
  }

  console.log(`Saved messages, last ${messages.length} message(s) — names and counts only:\n`)
  console.log(`  fields seen across them: ${[...fields].sort().join(", ")}`)
  console.log(`  carry \`updateTime\`:      ${withUpdateTime}`)
  console.log(`  whose updateTime > time: ${updatedAfterSent}`)
  console.log(
    `  \`status\` values:         ${statuses.size === 0 ? "none present" : [...statuses].map(([s, n]) => `${s}×${n}`).join(", ")}`,
  )

  console.log(
    `\n${
      withUpdateTime > 0
        ? "An edit IS marked at the source — the cache can compare `updateTime` and needs no hash."
        : "No `updateTime` on any message here. Either the edit is not marked, or it is marked some other way — the cache needs a fallback."
    }`,
  )
  console.log(
    "A deleted message cannot be seen directly: it is absent, which is why a re-read window must be contiguous.",
  )
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await connection.close()
}
