import type { CacheDatabase } from "./driver.js"

/**
 * **Raise this on every change to the statements below.** The second schema change is the one that
 * corrupts somebody's file, because the first is always made while the only copy is your own.
 */
export const SCHEMA_VERSION = 1

/**
 * Everything the cache holds, and the indexes are part of it rather than an afterthought — each
 * one exists for a query that is actually made.
 *
 * **Times are epoch milliseconds**, the way MAX sends them: an integer sorts, compares and ranges
 * correctly without a format to agree on. The domain model's ISO strings are built on the way out.
 *
 * Ids are text even though MAX sends numbers. They are 64-bit, they are identifiers rather than
 * arithmetic, and `INTEGER` here would put the rounding this project already fixed back again.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS chats (
     id                 TEXT PRIMARY KEY,
     title              TEXT,
     kind               TEXT NOT NULL,
     unread_count       INTEGER,
     last_message_at    INTEGER,
     participants_count INTEGER,
     generation         INTEGER NOT NULL DEFAULT 0,
     fetched_at         INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS chats_by_recency ON chats (last_message_at DESC)`,

  `CREATE TABLE IF NOT EXISTS contacts (
     id          TEXT PRIMARY KEY,
     name        TEXT,
     username    TEXT,
     description TEXT,
     fetched_at  INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS messages (
     chat_id     TEXT NOT NULL,
     id          TEXT NOT NULL,
     sender_id   TEXT,
     sender_name TEXT,
     time        INTEGER NOT NULL,
     update_time INTEGER,
     text        TEXT NOT NULL,
     outgoing    INTEGER,
     attachments TEXT NOT NULL,
     fetched_at  INTEGER NOT NULL,
     PRIMARY KEY (chat_id, id)
   )`,
  `CREATE INDEX IF NOT EXISTS messages_by_time ON messages (chat_id, time DESC)`,
  `CREATE INDEX IF NOT EXISTS messages_by_update ON messages (chat_id, update_time)`,

  /**
   * The windows we claim to hold **completely**, which is what makes "absent means deleted" safe
   * to believe. A message outside every range is a message we have never looked for; a message
   * missing from inside one has been deleted.
   */
  `CREATE TABLE IF NOT EXISTS ranges (
     chat_id   TEXT NOT NULL,
     from_time INTEGER NOT NULL,
     to_time   INTEGER NOT NULL,
     PRIMARY KEY (chat_id, from_time)
   )`,
  `CREATE INDEX IF NOT EXISTS ranges_by_chat ON ranges (chat_id, from_time)`,

  /**
   * When a whole collection was last known to be complete. A `fetched_at` on each row cannot say
   * this: it tells you when a chat was seen, never that the list of chats has no newcomer missing
   * from it.
   */
  `CREATE TABLE IF NOT EXISTS fetched (
     kind TEXT PRIMARY KEY,
     at   INTEGER NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS fetch_lease (
     chat_id    TEXT NOT NULL,
     anchor     TEXT NOT NULL,
     holder     TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     PRIMARY KEY (chat_id, anchor)
   )`,
]

/**
 * Brings a file up to date, and **refuses a file from the future** rather than writing to it.
 *
 * A newer `max` may have added a column this one does not know about. Reading it is survivable;
 * writing to it is how one version quietly destroys what another stored.
 */
export const migrate = (database: CacheDatabase): void => {
  const current = Number(
    (database.prepare("PRAGMA user_version").get() as { user_version?: number })?.user_version ?? 0,
  )

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `this cache was written by a newer max (schema ${current}, this one speaks ${SCHEMA_VERSION}) — ` +
        "run `max cache clear`, or use the newer version",
    )
  }

  for (const statement of STATEMENTS) database.exec(statement)
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}
