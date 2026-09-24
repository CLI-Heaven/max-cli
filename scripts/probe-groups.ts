/**
 * Do the group operations PyMax sends work as it sends them? Run by hand, never by CI.
 *
 *   pnpm probe:groups
 *
 * **Creates one empty group, "max-cli probe", with nobody else in it** (`NEED-198`), then renames
 * it, sets one setting, replaces its invite link, reads its join requests, leaves it and joins it
 * again by link. Nobody else is ever added, so nobody sees any of it.
 *
 * ⚠ **It ends as a member, on purpose.** The group stays in the owner's chat list to be deleted by
 * hand (`NEED-32`). The first run on 2026-09-24 ended by leaving: that left an empty group with no
 * members, out of the owner's list and out of reach, since the link is never printed.
 *
 * Printed: field names, enum values, counts and this script's own test titles — never the invite
 * link, only its shape, and no person's id.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const keys = (value: unknown) => Object.keys(record(value)).sort().join(", ")

const linkShape = (link: unknown) =>
  typeof link === "string" ? link.replace(/[^/]+$/, (tail) => `<${tail.length} chars>`) : String(link)

const chatSummary = (chat: unknown) => {
  const c = record(chat)
  return [
    `  chat fields: ${keys(c)}`,
    `  type=${String(c.type)} access=${String(c.access)} status=${String(c.status)} title=${JSON.stringify(c.title)}`,
    `  options=${JSON.stringify(c.options)} link=${linkShape(c.link)}`,
    `  participants: ${Object.keys(record(c.participants)).length} admins: ${Array.isArray(c.admins) ? c.admins.length : "absent"}`,
  ].join("\n")
}

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

const step = async (label: string, opcode: number, payload: Record<string, unknown>) => {
  try {
    const answer = await connection.invoke(opcode, payload)
    console.log(`\n${label} (${opcode}) answered: ${keys(answer) || "{}"}`)
    if (answer.chat) console.log(chatSummary(answer.chat))
    return answer
  } catch (error) {
    console.log(`\n${label} (${opcode}) failed: ${(error as Error).message}`)
    return undefined
  }
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const created = await step("create", 64, {
    message: {
      cid: Date.now(),
      attaches: [{ _type: "CONTROL", event: "new", chatType: "CHAT", title: "max-cli probe", userIds: [] }],
    },
    notify: false,
  })
  if (!created) process.exit(1)
  const message = record(created.message)
  console.log(`  message fields: ${keys(message)}`)
  console.log(`  message attaches: ${JSON.stringify((message.attaches as unknown[] | undefined)?.map(keys))}`)
  const chat = record(created.chat)
  const chatId = asId(chat.id) ?? asId(message.chatId) ?? asId(created.chatId)
  if (!chatId) {
    console.log("no chat id in the answer — stopping")
    process.exit(1)
  }
  const id = BigInt(chatId)
  console.log(`  chat id ${chatId} — delete this group by hand in MAX`)

  const joinPath = (link: unknown) => (typeof link === "string" ? link.slice(link.indexOf("join/")) : undefined)
  const firstLink = joinPath(chat.link)
  if (firstLink) await step("link info", 89, { link: firstLink })

  await step("rename", 55, { chatId: id, theme: "max-cli probe renamed", description: "max-cli probe" })
  await step("settings", 55, { chatId: id, options: { ALL_CAN_PIN_MESSAGE: true } })
  const reworked = await step("new link", 55, { chatId: id, revokePrivateLink: true })
  const newLink = joinPath(record(reworked?.chat).link)
  console.log(`  link changed: ${newLink !== undefined && newLink !== firstLink}`)

  const requests = await step("join requests", 59, { chatId: id, type: "JOIN_REQUEST", count: 100 })
  console.log(`  members: ${Array.isArray(requests?.members) ? requests.members.length : "absent"}`)

  await step("leave", 58, { chatId: id })
  if (newLink) {
    await step("link info after leaving", 89, { link: newLink })
    await step("join", 57, { link: newLink })
  }
} finally {
  await connection.close()
}
