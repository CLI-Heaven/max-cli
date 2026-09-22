import { asId, type Payload } from "../protocol/frame.js"
import type { Attachment, Chat, ChatKind, Contact, Id, Message, Profile } from "./models.js"

/**
 * Wire shapes into our own types.
 *
 * **Tolerant when reading** (REQUIREMENTS §29): an unknown field is ignored, a missing one becomes
 * `null`, and nothing here throws. This is an unofficial protocol — a response that gained a field
 * must not break a command, and a response that lost one must say so rather than invent a value.
 */

export interface NameLookup {
  /** Display names by user id, built from the `contacts` the login response carries. */
  names?: Map<Id, string>
  /** Whose account this is, so a message can say whether it is ours. */
  viewerId?: Id
}

export const toChat = (raw: Payload): Chat => ({
  id: asId(raw.id) ?? "",
  title: text(raw.title),
  kind: chatKind(raw.type),
  unreadCount: count(raw.newMessages),
  lastMessageAt: timestamp(raw.lastEventTime ?? asRecord(raw.lastMessage)?.time),
  participantsCount: count(raw.participantsCount),
})

export const toMessage = (raw: Payload, chatId: Id, lookup: NameLookup = {}): Message => {
  const senderId = asId(raw.sender)

  return {
    id: asId(raw.id) ?? "",
    chatId,
    senderId: senderId ?? null,
    senderName: senderId ? (lookup.names?.get(senderId) ?? null) : null,
    timestamp: timestamp(raw.time) ?? new Date(0).toISOString(),
    editedAt: timestamp(raw.updateTime),
    text: text(raw.text) ?? "",
    outgoing: lookup.viewerId === undefined || senderId === undefined ? null : senderId === lookup.viewerId,
    attachments: attachments(raw.attaches),
  }
}

/** `lastMessagedAt` is always `null` here: MAX puts it on the chat, and only the store has both. */
export const toContact = (raw: Payload): Contact => ({
  id: asId(raw.id) ?? "",
  name: displayName(raw.names) ?? text(raw.name),
  username: text(raw.link),
  description: text(raw.description),
  lastMessagedAt: null,
})

export const toProfile = (raw: Payload): Profile => {
  const contact = asRecord(raw.contact) ?? raw

  return {
    id: asId(contact.id) ?? "",
    name: displayName(contact.names) ?? text(contact.name),
    phone: phone(contact.phones) ?? text(contact.phone),
  }
}

/** The names a login response carries, so a message can name its sender without another request. */
export const namesFrom = (contacts: unknown): Map<Id, string> => {
  const names = new Map<Id, string>()
  if (!Array.isArray(contacts)) return names

  for (const entry of contacts) {
    const contact = asRecord(entry)
    if (!contact) continue
    const id = asId(contact.id)
    const name = displayName(contact.names) ?? text(contact.name)
    if (id && name) names.set(id, name)
  }
  return names
}

const asRecord = (value: unknown): Payload | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : undefined

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null)

const count = (value: unknown): number | null => {
  const asNumber = typeof value === "bigint" ? Number(value) : value
  return typeof asNumber === "number" && Number.isFinite(asNumber) ? asNumber : null
}

/** MAX sends Unix milliseconds; output is ISO 8601, which sorts, parses and needs no timezone guess. */
const timestamp = (value: unknown): string | null => {
  const ms = count(value)
  if (ms === null || ms <= 0) return null
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const chatKind = (value: unknown): ChatKind => {
  switch (typeof value === "string" ? value.toUpperCase() : "") {
    case "DIALOG":
      return "dialog"
    case "CHAT":
      return "group"
    case "CHANNEL":
      return "channel"
    default:
      return "unknown"
  }
}

/** `names` is a list of `{name, type}`; the full name wins, and any name beats none. */
const displayName = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null
  const entries = value.map(asRecord).filter((entry): entry is Payload => entry !== undefined)
  const full = entries.find((entry) => entry.type === "FULL_NAME")
  return text(full?.name) ?? text(entries[0]?.name)
}

const phone = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null
  const first = asRecord(value[0])
  const number = first?.number
  return text(number) ?? (typeof number === "number" || typeof number === "bigint" ? `+${number}` : null)
}

/**
 * What an attachment is and where it lives — never its bytes. The link fields are the ones
 * `pnpm probe:attachments` measured on 2026-09-22: `baseUrl` on a photo, `url` on a share.
 */
const attachments = (value: unknown): Attachment[] => {
  if (!Array.isArray(value)) return []
  return value
    .map(asRecord)
    .filter((entry): entry is Payload => entry !== undefined)
    .map((entry) => {
      const url = text(entry.baseUrl) ?? text(entry.url)
      const width = count(entry.width)
      const height = count(entry.height)
      const title = text(entry.title)
      return {
        kind: typeof entry._type === "string" ? entry._type.toLowerCase() : "unknown",
        ...(url ? { url } : {}),
        ...(width !== null ? { width } : {}),
        ...(height !== null ? { height } : {}),
        ...(title ? { title } : {}),
      }
    })
}
