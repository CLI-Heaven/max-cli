import type { Chat, Contact, Id, Message } from "../domain/models.js"
import type { CacheDatabase } from "./driver.js"
import { migrate } from "./schema.js"

export interface CacheOptions {
  database: CacheDatabase
  /** Injected so a freshness test costs nothing and does not wait. */
  now?: () => number
}

/** Nothing here ever throws on missing data: absent is a cache miss, not an error. */
export interface CacheStore {
  chats: {
    read(freshForMs: number): Chat[] | undefined
    write(chats: Chat[]): void
  }
  contacts: {
    read(freshForMs: number): Contact[] | undefined
    write(contacts: Contact[]): void
  }
  messages: {
    /** The newest `limit` messages, but only if the window we hold is both fresh and contiguous. */
    read(chatId: Id, limit: number, freshForMs: number): Message[] | undefined
    write(chatId: Id, messages: Message[]): void
    /** After a send, what we hold for that chat is missing the message we just added. */
    invalidate(chatId: Id): void
  }
  /** True when this process may go to MAX for that window; false when somebody else already is. */
  claim(chatId: Id, anchor: string, holder: string, forMs: number): boolean
  release(chatId: Id, anchor: string): void
  clear(): void
  close(): void
}

export const openStore = ({ database, now = () => Date.now() }: CacheOptions): CacheStore => {
  migrate(database)

  const markFetched = database.prepare(
    "INSERT INTO fetched (kind, at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET at = excluded.at",
  )
  const fetchedAt = database.prepare("SELECT at FROM fetched WHERE kind = ?")

  const isFresh = (kind: string, freshForMs: number): boolean => {
    const at = (fetchedAt.get(kind) as { at?: number } | undefined)?.at
    return at !== undefined && now() - at <= freshForMs
  }

  const putChat = database.prepare(`
    INSERT INTO chats (id, title, kind, unread_count, last_message_at, participants_count, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, kind = excluded.kind, unread_count = excluded.unread_count,
      last_message_at = excluded.last_message_at, participants_count = excluded.participants_count,
      fetched_at = excluded.fetched_at, generation = chats.generation + 1`)

  const putContact = database.prepare(`
    INSERT INTO contacts (id, name, username, description, fetched_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, username = excluded.username,
      description = excluded.description, fetched_at = excluded.fetched_at`)

  /**
   * **Compares MAX's clock, never ours.** `update_time` is what MAX sets on an edit and is `NULL`
   * on a message nobody has changed (measured 2026-09-20).
   *
   * The comparison has to be on that value rather than on when we fetched, and the difference is
   * not academic: agent A reads a chat after an edit, agent B read it before but finishes writing
   * second. Ordering on fetch time puts B's pre-edit text back over A's correct one. Ordering on
   * MAX's `update_time`, an edit always beats a version that never saw it, whoever writes last.
   *
   * `>=` rather than `>` so that two ordinary re-fetches of the same unedited message both go
   * through — they carry identical text, so the write is harmless and refreshing `fetched_at` is
   * the point of it.
   */
  const putMessage = database.prepare(`
    INSERT INTO messages (chat_id, id, sender_id, sender_name, time, update_time, text, outgoing, attachments, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, id) DO UPDATE SET
      sender_name = excluded.sender_name, update_time = excluded.update_time, text = excluded.text,
      outgoing = excluded.outgoing, attachments = excluded.attachments, fetched_at = excluded.fetched_at
    WHERE coalesce(excluded.update_time, 0) >= coalesce(messages.update_time, 0)`)

  const toChat = (row: Record<string, unknown>): Chat => ({
    id: String(row.id),
    title: row.title === null ? null : String(row.title),
    kind: String(row.kind) as Chat["kind"],
    unreadCount: row.unread_count === null ? null : Number(row.unread_count),
    lastMessageAt: row.last_message_at === null ? null : new Date(Number(row.last_message_at)).toISOString(),
    participantsCount: row.participants_count === null ? null : Number(row.participants_count),
  })

  const toMessage = (row: Record<string, unknown>): Message => ({
    id: String(row.id),
    chatId: String(row.chat_id),
    senderId: row.sender_id === null ? null : String(row.sender_id),
    senderName: row.sender_name === null ? null : String(row.sender_name),
    timestamp: new Date(Number(row.time)).toISOString(),
    editedAt: row.update_time === null ? null : new Date(Number(row.update_time)).toISOString(),
    text: String(row.text),
    outgoing: row.outgoing === null ? null : row.outgoing === 1,
    attachments: JSON.parse(String(row.attachments)) as Message["attachments"],
  })

  const epoch = (iso: string | null): number | null => (iso === null ? null : new Date(iso).getTime())

  return {
    chats: {
      read: (freshForMs) => {
        if (!isFresh("chats", freshForMs)) return undefined
        return database.prepare("SELECT * FROM chats ORDER BY last_message_at DESC").all().map(toChat)
      },
      write: (chats) => {
        const at = now()
        for (const chat of chats) {
          putChat.run(
            chat.id,
            chat.title,
            chat.kind,
            chat.unreadCount,
            epoch(chat.lastMessageAt),
            chat.participantsCount,
            at,
          )
        }
        markFetched.run("chats", at)
      },
    },

    contacts: {
      read: (freshForMs) => {
        if (!isFresh("contacts", freshForMs)) return undefined
        return database
          .prepare("SELECT * FROM contacts ORDER BY name")
          .all()
          .map((row) => ({
            id: String(row.id),
            name: row.name === null ? null : String(row.name),
            username: row.username === null ? null : String(row.username),
            description: row.description === null ? null : String(row.description),
          }))
      },
      write: (contacts) => {
        const at = now()
        for (const contact of contacts) {
          putContact.run(contact.id, contact.name, contact.username, contact.description, at)
        }
        markFetched.run("contacts", at)
      },
    },

    messages: {
      read: (chatId, limit, freshForMs) => {
        if (!isFresh(`messages:${chatId}`, freshForMs)) return undefined
        const rows = database
          .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY time DESC LIMIT ?")
          .all(chatId, limit)

        // A window we never claimed to hold completely cannot answer "the newest twenty": we have
        // no way to know whether a twenty-first arrived between the fetch and now.
        const range = database
          .prepare("SELECT to_time FROM ranges WHERE chat_id = ? ORDER BY to_time DESC LIMIT 1")
          .get(chatId)
        if (!range) return undefined

        return rows.map(toMessage).reverse()
      },
      write: (chatId, messages) => {
        if (messages.length === 0) return
        const at = now()
        for (const message of messages) {
          putMessage.run(
            chatId,
            message.id,
            message.senderId,
            message.senderName,
            epoch(message.timestamp) ?? 0,
            epoch(message.editedAt),
            message.text,
            message.outgoing === null ? null : Number(message.outgoing),
            JSON.stringify(message.attachments),
            at,
          )
        }

        const times = messages.map((message) => epoch(message.timestamp) ?? 0)
        database
          .prepare(
            `INSERT INTO ranges (chat_id, from_time, to_time) VALUES (?, ?, ?)
             ON CONFLICT(chat_id, from_time) DO UPDATE SET to_time = max(ranges.to_time, excluded.to_time)`,
          )
          .run(chatId, Math.min(...times), Math.max(...times))
        markFetched.run(`messages:${chatId}`, at)
      },
      invalidate: (chatId) => {
        database.prepare("DELETE FROM fetched WHERE kind = ?").run(`messages:${chatId}`)
      },
    },

    claim: (chatId, anchor, holder, forMs) => {
      const at = now()
      return (
        database
          .prepare(
            `INSERT INTO fetch_lease (chat_id, anchor, holder, expires_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(chat_id, anchor) DO UPDATE
               SET holder = excluded.holder, expires_at = excluded.expires_at
               WHERE fetch_lease.expires_at <= ?`,
          )
          .run(chatId, anchor, holder, at + forMs, at).changes === 1
      )
    },

    release: (chatId, anchor) => {
      database.prepare("DELETE FROM fetch_lease WHERE chat_id = ? AND anchor = ?").run(chatId, anchor)
    },

    clear: () => {
      for (const table of ["messages", "chats", "contacts", "ranges", "fetched", "fetch_lease"]) {
        database.exec(`DELETE FROM ${table}`)
      }
    },

    close: () => database.close(),
  }
}
