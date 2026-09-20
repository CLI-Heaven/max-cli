import type { Chat, Contact, Id, Message } from "../domain/models.js"
import type { CacheDatabase } from "./driver.js"
import { migrate } from "./schema.js"

/** How we came to know a person. Diagnostic — what makes somebody a *contact* is the query. */
export type PersonSource = "login" | "info" | "participant" | "sync"

export type PersonOrder = "recent" | "name"

export interface PageOptions {
  order: PersonOrder
  limit: number
  offset: number
}

/**
 * One login's worth of change: the chats that moved, the people that changed, who is in which
 * chat, and the `time` MAX answered with.
 *
 * `members` is keyed by chat id and holds that chat's **whole** membership minus ourselves, so a
 * chat named here has its rows replaced rather than added to. A chat absent from the map keeps
 * the members it already had.
 */
/**
 * What a merge did, in counts and **nothing else** — no name, no username, no description. It is
 * what `max contacts sync` prints, and a summary that named anybody would be the one place the
 * sixth constraint leaks.
 *
 * `changed` is "already known and sent again". A delta carries only what moved, so for an ordinary
 * login that is exactly what it sounds like; for a full re-take, where MAX resends everything, it
 * reads as "re-sent" instead — which is what `full` in the command's output is there to say.
 */
export interface SyncSummary {
  known: number
  added: number
  changed: number
}

export interface SyncDelta {
  chats: Chat[]
  people: Contact[]
  members: Map<Id, Id[]>
  marker: number
}

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
    /** One page, newest first, in SQL rather than by building the whole list and slicing it. */
    page(options: { limit: number; offset: number }): Chat[]
    count(): number
  }
  contacts: {
    read(freshForMs: number): Contact[] | undefined
    write(contacts: Contact[]): void
  }
  people: {
    /**
     * One page of **contacts** — the people a one-to-one chat exists with. `recent` is
     * `last_messaged_at` newest first, the never-messaged last, then by name.
     *
     * A group member is not in this answer, and nothing marks them as excluded: they are simply
     * not in the set the query asks for (`NEED-105`).
     */
    contacts(options: PageOptions): Contact[]
    /** How many that query would return, so a page can say whether another one exists. */
    countContacts(): number
    /** Everyone we can put a name to, contact or not. */
    page(options: PageOptions): Contact[]
    /** Everyone, counted — what `max contacts sync` reports as known. */
    count(): number
    /** Carries how we met them. Never deletes: absence from a delta means unchanged. */
    upsert(people: Contact[], source: PersonSource): void
    /** The chats this person is in — which, every chat here being one we are in, is the shared set. */
    chatsWith(personId: Id): Id[]
  }
  /** The `time` the last login answered with, or `undefined` for a store that has never synced. */
  syncMarker(): number | undefined
  /** Rows, memberships, recency and the marker — **in one transaction**. */
  mergeDelta(delta: SyncDelta): SyncSummary
  /** Makes the next login ask for everything again. */
  forgetSyncMarker(): void
  messages: {
    /** The newest `limit` messages, but only if the window we hold is both fresh and contiguous. */
    read(chatId: Id, limit: number, freshForMs: number): Message[] | undefined
    write(chatId: Id, messages: Message[]): void
    /** After a send, what we hold for that chat is missing the message we just added. */
    invalidate(chatId: Id): void
    /**
     * When a message was sent, for `messages list --before <id>`.
     *
     * `undefined` for an id we have never stored — which is exactly what a deleted message looks
     * like, since it is no longer in the history MAX returns either.
     */
    timeOf(id: Id): number | undefined
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

  /**
   * **`COALESCE`, not assignment, for the three names.** The same person arrives from several
   * places — the login, `CONTACT_INFO`, a group's participant list — and not all of them carry a
   * description or a username. Overwriting with what the latest one happened to omit would blank
   * a name we already had, which is the one thing this table exists to prevent.
   */
  const putPerson = database.prepare(`
    INSERT INTO people (id, name, username, description, last_messaged_at, source, fetched_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = coalesce(excluded.name, people.name),
      username = coalesce(excluded.username, people.username),
      description = coalesce(excluded.description, people.description),
      source = excluded.source, fetched_at = excluded.fetched_at`)

  const toContact = (row: Record<string, unknown>): Contact => ({
    id: String(row.id),
    name: row.name === null ? null : String(row.name),
    username: row.username === null ? null : String(row.username),
    description: row.description === null ? null : String(row.description),
    lastMessagedAt: row.last_messaged_at === null ? null : new Date(Number(row.last_messaged_at)).toISOString(),
  })

  /**
   * `NULLS LAST` spelled out as a sort key rather than as syntax: it arrived in SQLite 3.30 and
   * this runs on whatever `node:sqlite` and `bun:sqlite` were built against.
   */
  const ORDER: Record<PersonOrder, string> = {
    recent: "p.last_messaged_at IS NULL, p.last_messaged_at DESC, p.name IS NULL, p.name",
    name: "p.name IS NULL, p.name",
  }

  /** People a *dialog* exists with. The join is the definition of "contact" (`NEED-105`). */
  const CONTACTS_FROM = `
    FROM people p
      JOIN chat_members m ON m.person_id = p.id
      JOIN chats c        ON c.id = m.chat_id AND c.kind = 'dialog'`

  const upsertPeople = (people: Contact[], source: PersonSource, at: number): void => {
    for (const person of people) {
      if (!person.id) continue
      putPerson.run(person.id, person.name, person.username, person.description, source, at)
    }
  }

  /**
   * SQLite has no nested transactions and this is the only writer that needs one, so a plain
   * `BEGIN` is enough. The rollback is what item 4 of the plan turns on: a marker saved over rows
   * that were never written makes the next login ask for changes since data we do not have, and
   * nothing downstream ever notices.
   */
  const inTransaction = (body: () => void): void => {
    database.exec("BEGIN")
    try {
      body()
      database.exec("COMMIT")
    } catch (error) {
      database.exec("ROLLBACK")
      throw error
    }
  }

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
      page: ({ limit, offset }) =>
        database
          .prepare("SELECT * FROM chats ORDER BY last_message_at DESC LIMIT ? OFFSET ?")
          .all(limit, offset)
          .map(toChat),

      count: () => Number((database.prepare("SELECT COUNT(*) AS n FROM chats").get() as { n?: number })?.n ?? 0),

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
        return database.prepare(`SELECT * FROM people p ORDER BY ${ORDER.name}`).all().map(toContact)
      },
      write: (contacts) => {
        const at = now()
        upsertPeople(contacts, "login", at)
        markFetched.run("contacts", at)
      },
    },

    people: {
      contacts: ({ order, limit, offset }) =>
        database
          .prepare(`SELECT DISTINCT p.* ${CONTACTS_FROM} ORDER BY ${ORDER[order]} LIMIT ? OFFSET ?`)
          .all(limit, offset)
          .map(toContact),

      countContacts: () =>
        Number((database.prepare(`SELECT COUNT(DISTINCT p.id) AS n ${CONTACTS_FROM}`).get() as { n?: number })?.n ?? 0),

      page: ({ order, limit, offset }) =>
        database
          .prepare(`SELECT p.* FROM people p ORDER BY ${ORDER[order]} LIMIT ? OFFSET ?`)
          .all(limit, offset)
          .map(toContact),

      upsert: (people, source) => upsertPeople(people, source, now()),

      count: () => Number((database.prepare("SELECT COUNT(*) AS n FROM people").get() as { n?: number })?.n ?? 0),

      chatsWith: (personId) =>
        database
          .prepare("SELECT chat_id FROM chat_members WHERE person_id = ?")
          .all(personId)
          .map((row) => String(row.chat_id)),
    },

    syncMarker: () =>
      (database.prepare("SELECT marker FROM sync_marker WHERE id = 1").get() as { marker?: number } | undefined)
        ?.marker,

    mergeDelta: ({ chats, people, members, marker }) => {
      const at = now()
      const summary: SyncSummary = { known: 0, added: 0, changed: 0 }

      inTransaction(() => {
        const known = database.prepare("SELECT 1 FROM people WHERE id = ?")
        for (const person of people) {
          if (!person.id) continue
          if (known.get(person.id)) summary.changed += 1
          else summary.added += 1
        }

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

        upsertPeople(people, "login", at)

        // Replaced per chat, never globally: MAX restates a chat's whole membership whenever it
        // sends that chat, so a member missing from it has left — while a *person* missing from a
        // delta is merely unchanged, which after the first login is every person we know.
        for (const [chatId, personIds] of members) {
          database.prepare("DELETE FROM chat_members WHERE chat_id = ?").run(chatId)
          for (const personId of personIds) {
            database
              .prepare("INSERT OR IGNORE INTO chat_members (chat_id, person_id) VALUES (?, ?)")
              .run(chatId, personId)
          }
        }

        // The default order, written on the same transaction as the rows it orders, so the two can
        // never disagree. It reads the memberships just written rather than the delta, so a dialog
        // that arrived without its participants still moves the person it is with.
        for (const chat of chats) {
          const messagedAt = epoch(chat.lastMessageAt)
          if (chat.kind !== "dialog" || messagedAt === null) continue
          database
            .prepare(
              `UPDATE people SET last_messaged_at = max(coalesce(last_messaged_at, 0), ?)
               WHERE id IN (SELECT person_id FROM chat_members WHERE chat_id = ?)`,
            )
            .run(messagedAt, chat.id)
        }

        database
          .prepare(
            "INSERT INTO sync_marker (id, marker) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET marker = excluded.marker",
          )
          .run(marker)

        summary.known = Number((database.prepare("SELECT COUNT(*) AS n FROM people").get() as { n?: number })?.n ?? 0)
      })

      return summary
    },

    forgetSyncMarker: () => {
      database.exec("DELETE FROM sync_marker")
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
      timeOf: (id) => {
        const row = database.prepare("SELECT time FROM messages WHERE id = ? LIMIT 1").get(id) as
          | { time?: number }
          | undefined
        return row?.time === undefined ? undefined : Number(row.time)
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
      for (const table of [
        "messages",
        "chats",
        "people",
        "chat_members",
        "sync_marker",
        "ranges",
        "fetched",
        "fetch_lease",
      ]) {
        database.exec(`DELETE FROM ${table}`)
      }
    },

    close: () => database.close(),
  }
}
