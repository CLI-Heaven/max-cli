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
  /**
   * When MAX last recorded an edit, or `null` for a message nobody has changed.
   *
   * Measured 2026-09-20: an edited message comes back carrying `status: "EDITED"` and an
   * `updateTime` later than its `time`. Surfaced rather than hidden because a reader has no other
   * way to tell an edited message from the original, and because it is what the cache compares to
   * decide whether the copy it holds is still current.
   */
  editedAt: string | null
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
  /**
   * The newest message in a one-to-one chat with them, ISO 8601, and `null` for somebody we have
   * only ever met in a group. It is what `--order recent` sorts on.
   *
   * MAX does not send this on a contact: it comes from the chat, and only the store has both.
   */
  lastMessagedAt: string | null
}

/**
 * One page of a listing, and **the same shape whether it came from MAX or from the store** — where
 * rows come from is the exit code's business and the diagnostics', never the answer's.
 *
 * `hasMore` rather than a total: a pager asks whether to offer the next page, and counting rows
 * MAX has not sent is a second question with a second cost.
 */
export interface Page<T> {
  items: T[]
  hasMore: boolean
}

export interface Profile {
  id: Id
  name: string | null
  phone: string | null
}
