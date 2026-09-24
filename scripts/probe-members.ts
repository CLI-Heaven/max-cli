/**
 * Do the member operations of opcode 77 work as PyMax sends them? Run by hand, never by CI.
 *
 *   pnpm probe:members <person>
 *
 * `<person>` is a user id, or the id of the owner's one-to-one chat with them (what
 * `web.max.ru/<id>` shows). **That person is added to a new group and sees it** — run only with
 * their agreement (`MAX-41`). The script creates "max-cli probe members", sets a setting to a value
 * it did not have, adds the person, makes them an admin, tries to take the admin rights back, and
 * removes them. It ends as a member, so the owner can delete the group by hand (`NEED-32`).
 *
 * Printed: field names, enum values, counts and whether the person is in a list — never an id.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"

const reference = process.argv[2]
if (!reference || !/^\d+$/.test(reference)) {
  console.error("usage: pnpm probe:members <user id, or the id of a one-to-one chat>")
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

const keys = (value: unknown) => Object.keys(record(value)).sort().join(", ")

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

let person = ""
const standing = (chat: unknown) => {
  const c = record(chat)
  const admins = Array.isArray(c.admins) ? c.admins.map((one) => asId(one)) : []
  const adminParticipants = record(c.adminParticipants)
  return [
    `  participants: ${Object.keys(record(c.participants)).length}, person is a member: ${person in record(c.participants)}`,
    `  person is an admin: ${admins.includes(person)}, adminParticipants for them: ${keys(adminParticipants[person]) || "none"}`,
  ].join("\n")
}

const step = async (label: string, opcode: number, payload: Record<string, unknown>) => {
  try {
    const answer = await connection.invoke(opcode, payload)
    console.log(`\n${label} (${opcode}) answered: ${keys(answer) || "{}"}`)
    if (answer.chat) console.log(standing(answer.chat))
    return answer
  } catch (error) {
    console.log(`\n${label} (${opcode}) failed: ${(error as Error).message}`)
    return undefined
  }
}

try {
  await connection.open()
  const login = await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })

  const viewer = asId(record(record(login.profile).contact).id)
  const dialog = (Array.isArray(login.chats) ? login.chats : [])
    .map(record)
    .find((chat) => asId(chat.id) === reference && chat.type === "DIALOG")
  const partner = dialog ? Object.keys(record(dialog.participants)).find((id) => id !== viewer) : undefined
  person = partner ?? reference
  console.log(`person: ${dialog ? "taken from the one-to-one chat" : "the id as given"}`)

  const created = await step("create", 64, {
    message: {
      cid: Date.now(),
      attaches: [{ _type: "CONTROL", event: "new", chatType: "CHAT", title: "max-cli probe members", userIds: [] }],
    },
    notify: false,
  })
  const chatId = asId(record(created?.chat).id)
  if (!chatId) process.exit(1)
  const id = BigInt(chatId)
  const who = [BigInt(person)]

  const settings = await step("settings, a value it did not have", 55, {
    chatId: id,
    options: { ONLY_ADMIN_CAN_CALL: true },
  })
  console.log(
    `  ONLY_ADMIN_CAN_CALL now: ${JSON.stringify(record(record(settings?.chat).options).ONLY_ADMIN_CAN_CALL)}`,
  )

  await step("add", 77, { chatId: id, userIds: who, showHistory: true, operation: "add" })
  await step("make admin", 77, { chatId: id, userIds: who, type: "ADMIN", operation: "add", permissions: 18 })
  await step("take admin back", 77, { chatId: id, userIds: who, type: "ADMIN", operation: "remove" })
  await step("remove", 77, { chatId: id, userIds: who, operation: "remove", cleanMsgPeriod: 0 })
  console.log("\nthe group stays, with only the owner in it — delete it by hand in MAX")
} finally {
  await connection.close()
}
