import type { CacheDatabase } from "./driver.js"

/**
 * **Raise this on every change to the statements below.** The second schema change is the one that
 * corrupts somebody's file, because the first is always made while the only copy is your own.
 */
export const SCHEMA_VERSION = 2

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

  /**
   * **Everyone MAX has named for us, whatever the reason** — not an address book and not a contact
   * list. A group member gets a row here because their name has to live somewhere; whether they
   * are a *contact* is a question the query answers (a dialog with them exists), never a flag
   * somebody has to maintain (`NEED-105`).
   *
   * `last_messaged_at` is stored rather than derived because it is the default order: recomputing
   * `MAX(chats.last_message_at)` per person on every listing is the work this table exists to
   * avoid. `source` records how we met them and is diagnostic — it is not what the filter reads.
   */
  `CREATE TABLE IF NOT EXISTS people (
     id               TEXT PRIMARY KEY,
     name             TEXT,
     username         TEXT,
     description      TEXT,
     last_messaged_at INTEGER,
     source           TEXT NOT NULL,
     fetched_at       INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS people_by_recency ON people (last_messaged_at DESC)`,

  /**
   * Who is in what. It is what the client used to work out in memory and throw away, and it is how
   * "which groups do I share with this person" becomes one indexed lookup — every chat in this
   * database is one the owner is in, so the chats of a person *are* the shared set.
   */
  `CREATE TABLE IF NOT EXISTS chat_members (
     chat_id   TEXT NOT NULL,
     person_id TEXT NOT NULL,
     PRIMARY KEY (chat_id, person_id)
   )`,
  `CREATE INDEX IF NOT EXISTS members_by_person ON chat_members (person_id)`,

  /**
   * Where the last login's `time` is kept, so the next one can ask for the delta instead of the
   * whole collection. One row, and the `CHECK` is what keeps it that way.
   *
   * It lives here rather than in the profile's state file because a marker that outlives the rows
   * it describes is a promise this database cannot keep: `max cache clear` has to forget both in
   * the same breath, and a marker in another file would survive it.
   */
  `CREATE TABLE IF NOT EXISTS sync_marker (
     id     INTEGER PRIMARY KEY CHECK (id = 1),
     marker INTEGER NOT NULL
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
  /** `messages list --before <id>` resolves an id to its `time`, without knowing which chat. */
  `CREATE INDEX IF NOT EXISTS messages_by_id ON messages (id)`,

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
 *
 * **An older file is rebuilt, not altered.** Everything in here comes back from MAX, so a
 * column-by-column migration would be code that runs once, is tested never, and is how the second
 * schema change corrupts somebody's file. What a rebuild costs is one full login — which is what
 * every command did before the delta sync existed.
 *
 * ⚠ **This stops being the right answer the day the database holds something MAX cannot re-send.**
 * Contacts that are in no chat would be exactly that (`RES-7`), and the day they arrive this
 * becomes `ALTER TABLE … ADD COLUMN` and this paragraph gets rewritten.
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

  if (current > 0 && current < SCHEMA_VERSION) rebuild(database)

  for (const statement of STATEMENTS) database.exec(statement)
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/**
 * Drops what is there by asking the file rather than by listing what we think a previous version
 * wrote. A version that added a table we have since forgotten would otherwise survive the rebuild
 * and collide with a later name.
 *
 * The `fetched` table goes with the rest on purpose: it records that a collection was complete,
 * and keeping it would claim a sweep whose rows have just been thrown away.
 */
const rebuild = (database: CacheDatabase): void => {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()

  for (const { name } of tables) database.exec(`DROP TABLE IF EXISTS "${String(name)}"`)
}
