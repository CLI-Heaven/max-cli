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
  /**
   * A photo's image or a shared page. ⚠ Measured 2026-09-22: a photo link opens with no cookie and
   * no token, so whoever holds it sees the picture.
   */
  url?: string
  width?: number
  height?: number
  /** A shared page's title. */
  title?: string
  /** A file's name and size, measured 2026-09-23. */
  name?: string
  size?: number
  /** A file or a video carries no link, only these; `messages download` asks MAX for the link. */
  fileId?: Id
  videoId?: Id
}

/** Where one attachment's bytes can be fetched. Measured 2026-09-23: no token and no cookie needed. */
export interface AttachmentLink {
  kind: string
  url: string
  name?: string
  /** MAX flags the file as possibly harmful. */
  unsafe?: boolean
}

/** The reactions on one message, as MAX counts them. */
/** What a chat has pinned after `messages pin` or `unpin`; `null` is nothing. */
export interface Pin {
  chatId: Id
  pinned: Id | null
}

/** A chat marked read up to `messageId`, inclusive. `unread` is what MAX says is left, or `null`. */
export interface ReadMark {
  chatId: Id
  messageId: Id
  unread: number | null
}

export interface Reactions {
  counts: { reaction: string; count: number }[]
  /** This account's own reaction, or `null`. */
  mine: string | null
  total: number
}

/** The message a reply answers or a forward carries — MAX sends it whole, inside the one that links to it. */
export interface QuotedMessage {
  id: Id
  senderId: Id | null
  senderName: string | null
  /** ISO 8601, or `null` when the quote did not say. */
  timestamp: string | null
  text: string
  attachments: Attachment[]
  /** Whether this account wrote it. `null` when we do not know who we are. */
  outgoing: boolean | null
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
  replyTo: QuotedMessage | null
  forwardedFrom: QuotedMessage | null
  /**
   * `null` when nobody asked — `--offline`, or the request failed. History does not carry
   * reactions; they come from a request of their own, and the cache does not keep them.
   */
  reactions: Reactions | null
}

/**
 * A message found by searching, carrying the chat's name as well as its id.
 *
 * A search spans every chat, so an answer that named only the id would make the reader look each
 * one up to understand their own results. The title is what the store already holds; it is `null`
 * for a chat MAX never titled.
 */
export interface MessageHit extends Message {
  chatTitle: string | null
}

/** One chat's share of `max inbox`: other people's messages since the last check, oldest first. */
export interface InboxChat extends Pick<Chat, "id" | "title" | "kind" | "unreadCount"> {
  messages: Message[]
  /** There are more than `--limit`; these are the newest of them. */
  more: boolean
}

export interface Inbox {
  /** `unread` — what MAX counts unread; `new` — what arrived since the last check. */
  mode: "unread" | "new"
  /** ISO 8601, `new` only. `until` is where the next check starts. */
  since?: string
  until?: string
  chats: InboxChat[]
  /** Past the per-run cap on history requests, so not read. */
  skipped: Pick<Chat, "id" | "title" | "lastMessageAt">[]
  /** Only the 40 chats the login named were looked at, and there may be more. */
  partial: boolean
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

/** Somebody in a chat, as much of them as a chat card shows. */
export type Member = Pick<Contact, "id" | "name" | "username">

/** One chat and who is in it. `members` is `null` where nobody recorded that — a channel, always. */
export interface ChatCard extends Chat {
  members: Member[] | null
}

/** The settings MAX lets a group's owner change, under our names. */
export interface GroupSettings {
  allCanPin: boolean | null
  onlyAdminsAdd: boolean | null
  onlyAdminsCall: boolean | null
  onlyOwnerEditsInfo: boolean | null
  membersSeeLink: boolean | null
}

/** A group or channel as the group commands answer it. */
export interface GroupCard extends Chat {
  description: string | null
  /** `public`, `private` or `secret`, as MAX says it. */
  access: string | null
  /** The invite link. Only a member who may see it gets one. */
  link: string | null
  settings: GroupSettings
}

/** One person and the chats this account shares with them, newest first. */
export interface PersonCard extends Contact {
  chats: Pick<Chat, "id" | "title" | "kind" | "lastMessageAt">[]
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
  description: string | null
}

/** A chat folder. MAX's own filters and options are kept inside the client and sent back untouched. */
export interface Folder {
  id: string
  title: string
  /** Chats added to it by hand. A folder that selects by filter lists none. */
  chatIds: Id[]
}

/** Somewhere this account is logged in. MAX gives a session no id, so none can be ended alone. */
export interface AccountSession {
  current: boolean
  /** `WEB`, `ANDROID`… as MAX names the client. */
  client: string | null
  /** MAX's own description of the device and app. */
  device: string | null
  location: string | null
  lastActiveAt: string | null
}

export interface ContactImport {
  /** How many numbers went to MAX. */
  sent: number
  /** The numbers MAX answered for — measured once, on the owner's own number, which it recognised. */
  recognised: string[]
  contacts: Contact[]
}

/** One message of a window around another, which carries `anchor: true`. */
export type WindowedMessage = Message & { anchor?: true }

/**
 * When a message was sent, read from its id: **`id >> 16` is the send time in milliseconds**, the
 * low 16 bits a counter. Measured 2026-09-22 on three messages across two days, exact every time.
 * `undefined` for anything that is not a message id.
 */
export const timeOfMessageId = (id: Id): number | undefined => {
  if (!/^\d{10,20}$/.test(id)) return undefined
  const time = Number(BigInt(id) >> 16n)
  return Number.isSafeInteger(time) && time > 0 ? time : undefined
}
