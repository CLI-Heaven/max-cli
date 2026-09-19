/**
 * What this CLI promises. **Raw MAX objects never reach output** (REQUIREMENTS §16, §25): the wire
 * shape is undocumented, changes without notice, and carries fields whose meaning nobody knows.
 * Everything above the adapter speaks these types.
 */

/** Every id is a string, never a number: MAX ids are 64-bit and an id is an identifier, not arithmetic. */
export type Id = string

export type ChatKind = "dialog" | "group" | "channel" | "unknown"

export interface Chat {
  id: Id
  title: string | null
  kind: ChatKind
  /** `null` means MAX did not say, which is not the same as zero. */
  unreadCount: number | null
  /** ISO 8601, or `null` when the chat has never had a message. */
  lastMessageAt: string | null
  participantsCount: number | null
}

export interface Attachment {
  /** Lower-cased MAX type: `photo`, `video`, `file`, `share`, `call`, `control`, `sticker`… */
  kind: string
}

export interface Message {
  id: Id
  chatId: Id
  senderId: Id | null
  senderName: string | null
  /** ISO 8601. */
  timestamp: string
  text: string
  /** Whether this account sent it. `null` when we do not know who we are. */
  outgoing: boolean | null
  attachments: Attachment[]
}

export interface Contact {
  id: Id
  name: string | null
  /** The @link MAX shows for a person, when they have one. */
  username: string | null
  /** Whatever they wrote about themselves. */
  description: string | null
}

export interface Profile {
  id: Id
  name: string | null
  phone: string | null
}
