/**
 * Three pre-release questions answered on one login, with the owner's yes (`NEED-262`):
 *
 *   pnpm probe:pre-release "<group title>" [MAX-53 MAX-57 MAX-58 — only these]
 *
 * 1. `MAX-53` — what `CHATS_LIST` 53 `{marker}` answers when the marker is the time of the 15th
 *    chat of the login, as the web tab sends it: how many chats, and whether they continue the list.
 * 2. `MAX-57` — the longest folder title MAX accepts (22 refused, 13 taken). Each try is created and
 *    deleted at once.
 * 3. `MAX-58` — pin and unpin in the named group, `notify` off; the test message is then deleted for
 *    everyone.
 *
 * Printed: counts, positions, field names and MAX's own reasons — never a title, a name or an id.
 */
import { MaxClient } from "../dist/client.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { SessionStore } from "../dist/session/store.js"

const group = process.argv[2]
const only = process.argv.slice(3)
if (!group) {
  console.error('usage: pnpm probe:pre-release "<group title>"')
  process.exit(2)
}

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
if (!store.readToken()) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const TAB_LOGIN_CHATS = 15
const connection = new Connection({ timeoutMs: 20_000 })
const client = new MaxClient({ store, connection, timeoutMs: 20_000 })

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const reason = (error: unknown): string => {
  const payload = (error as { payload?: { error?: unknown } }).payload
  return String(payload?.error ?? (error as Error).message)
}

const chatsPage = async () => {
  const chats = (client.live.snapshot().chats as unknown[]).map(record)
  const position = new Map(chats.map((chat, at) => [asId(chat.id), at + 1]))
  console.log(`login chats: ${chats.length}`)

  // From the 15th chat is what the tab sends; from the newest shows how many one answer holds.
  for (const from of [TAB_LOGIN_CHATS, 1]) {
    const marker = chats[from - 1]?.lastEventTime
    if (typeof marker !== "number" && typeof marker !== "bigint") {
      console.log(`53 from chat ${from}: no lastEventTime`)
      continue
    }
    try {
      const answer = await connection.invoke(53, { marker: BigInt(marker) })
      const page = ((answer.chats as unknown[]) ?? []).map(record)
      const at = page.map((chat) => position.get(asId(chat.id)) ?? "new")
      const last = page.at(-1)?.lastEventTime
      const next =
        answer.marker === undefined
          ? "absent"
          : String(answer.marker) === String(last)
            ? "= last chat's lastEventTime"
            : "other"
      console.log(
        `53 from chat ${from}: ${page.length} chats, login positions ${at.join(" ")}; marker in answer: ${next}`,
      )
    } catch (error) {
      console.log(`53 from chat ${from}: FAIL ${reason(error)}`)
    }
  }
}

const folderLimit = async () => {
  const fits = async (length: number) => {
    const title = "max-cli limit ".padEnd(length, "x").slice(0, length)
    try {
      const folder = await client.folders.create(title)
      await client.folders.delete(folder.id)
      return true
    } catch (error) {
      console.log(`  ${length}: ${reason(error)}`)
      return false
    }
  }
  let low = 13
  let high = 22
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (await fits(middle)) low = middle
    else high = middle
    console.log(`  tried ${middle}: longest accepted ${low}, shortest refused ${high}`)
  }
  console.log(`folder title: ${low} characters accepted, ${high} refused`)
}

const pinInGroup = async () => {
  const chatId = await client.chats.resolve(group)
  const sent = await client.messages.send(chatId, `max-cli live check ${new Date().toISOString()}`)
  try {
    for (const [label, run] of [
      ["pin", () => client.messages.pin(chatId, sent.id)],
      ["unpin", () => client.messages.pin(chatId, null)],
    ] as const) {
      try {
        await run()
        console.log(`ok    ${label} in the group`)
      } catch (error) {
        console.log(`FAIL  ${label} in the group: ${reason(error)}`)
      }
    }
  } finally {
    await client.messages.delete(chatId, [sent.id], { forEveryone: true })
    console.log("ok    test message deleted for everyone")
  }
}

try {
  await client.connect()
  console.log("ok    login")
  for (const [label, run] of [
    ["chats page (MAX-53)", chatsPage],
    ["folder title limit (MAX-57)", folderLimit],
    ["pin in a group (MAX-58)", pinInGroup],
  ] as const) {
    if (only.length > 0 && !only.some((word) => label.includes(word))) continue
    console.log(`\n${label}`)
    await run().catch((error: unknown) => console.log(`FAIL  ${reason(error)}`))
  }
} finally {
  await client.close().catch(() => {})
}
