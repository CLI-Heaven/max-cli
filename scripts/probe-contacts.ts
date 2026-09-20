/**
 * Two questions about contacts that only MAX can answer. Run by hand, with the owner, never by CI.
 *
 *   max session start        # once, if there is no session yet
 *   pnpm probe:contacts
 *
 * **1. Is `contactsSync` a delta marker?** The LOGIN request carries `contactsSync`, `chatsSync`,
 * `presenceSync` and `draftsSync`, and `src/session/handshake.ts:38-41` sends `0` for all four.
 * The name says "everything changed since this point", which would make an incremental contact
 * sync a field we already send rather than a feature to build. Nobody has tried a non-zero value.
 *
 * **2. What is opcode 36?** tsmax and PyMax call it `CONTACT_LIST`, the protocol documentation
 * calls it `GET_BLOCKED` (`PROTO-1`). Both are reads. Until it is sent once, "every contact" is a
 * phrase with no operation behind it.
 *
 * ⚠ **Authorised by the owner** (`NEED-99`, «2 A»). It sends one unidentified opcode to a real
 * account, which is exactly what `src/spec/operations/contacts.ts` reserves 36 against doing
 * casually.
 *
 * **It prints field names, counts and booleans. Never a value** — no name, no phone number, no
 * username, no id, no message. A refusal prints its reason, which MAX writes itself.
 */
import { Connection } from "../dist/protocol/connection.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { sessionInit, sessionLogin } from "../dist/spec/operations/session.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()

if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const { deviceId } = store.readState()

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/**
 * Field names are in our documents already; the values behind them are somebody's life.
 *
 * ⚠ **A key is not always a field name.** MAX returns `presence` and `participants` as objects
 * *keyed by contact id*, so printing "the field names" of one prints a list of people. Caught by
 * running this script, not by reading it: the first version put seven of the owner's contact ids
 * on screen. Anything that looks like an id is counted instead of named.
 */
const KEYED_BY_ID = /^\d{6,}$/

const shape = (value: unknown): string => {
  if (Array.isArray(value)) {
    const first = record(value[0])
    return `${value.length} item(s)${first ? `, fields: ${describe(Object.keys(first))}` : ""}`
  }
  const object = record(value)
  return object ? `object, ${describe(Object.keys(object))}` : typeof value
}

const describe = (keys: string[]): string =>
  keys.some((key) => KEYED_BY_ID.test(key)) ? `${keys.length} key(s), keyed by id` : `fields: ${keys.join(", ")}`

const login = async (connection: Connection, contactsSync: number, chatsSync: number, others = 0) => {
  await connection.open()
  await connection.invoke(sessionInit.opcode, buildRequest(sessionInit, { userAgent: WEB_USER_AGENT, deviceId }))
  return await connection.invoke(
    sessionLogin.opcode,
    buildRequest(sessionLogin, {
      token,
      interactive: false,
      chatsCount: 40,
      chatsSync,
      contactsSync,
      presenceSync: others,
      draftsSync: others,
    }),
  )
}

const counted = (payload: Record<string, unknown>, key: string): number => {
  const value = payload[key]
  return Array.isArray(value) ? value.length : 0
}

console.log("1. does `contactsSync` ask for a delta?\n")

const first = new Connection()
let serverTime = 0
let baseline = { contacts: 0, chats: 0, messages: 0 }

try {
  const payload = await login(first, 0, 0)
  serverTime = typeof payload.time === "number" ? payload.time : Date.now()
  baseline = {
    contacts: counted(payload, "contacts"),
    chats: counted(payload, "chats"),
    messages: counted(payload, "messages"),
  }
  console.log(
    `   sync 0        → contacts ${baseline.contacts}, chats ${baseline.chats}, messages ${baseline.messages}`,
  )
  console.log(`   the answer carries \`time\`: ${typeof payload.time === "number" ? "yes" : "no"}`)
} finally {
  await first.close()
}

const second = new Connection()

try {
  const payload = await login(second, serverTime, serverTime)
  const after = {
    contacts: counted(payload, "contacts"),
    chats: counted(payload, "chats"),
    messages: counted(payload, "messages"),
  }
  console.log(`   sync <time>   → contacts ${after.contacts}, chats ${after.chats}, messages ${after.messages}`)

  console.log(`   the profile still came back: ${record(payload.profile) ? "yes" : "no"}`)
} catch (error) {
  console.log(`   sync <time>   → refused: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await second.close()
}

/**
 * The disconfirming half, and the reason this script is not two lines shorter.
 *
 * "Nothing came back for a future marker" is equally consistent with **any** non-zero value being
 * rejected or misread. A marker far enough in the past must return *everything* again; a marker
 * that is neither must return a subset. Without this, "it is a delta marker" is a guess wearing a
 * measurement's clothes.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000
const old = new Connection()

try {
  const payload = await login(old, serverTime - WEEK, serverTime - WEEK)
  const after = { contacts: counted(payload, "contacts"), chats: counted(payload, "chats") }
  console.log(`   sync <a week ago> → contacts ${after.contacts}, chats ${after.chats}`)

  if (after.contacts === baseline.contacts && after.chats === baseline.chats) {
    console.log("\n   → an old marker returns everything and a current one returns nothing:")
    console.log("     the field IS a delta marker. MAX sends what changed since the time given.")
  } else if (after.contacts === 0 && after.chats === 0) {
    console.log("\n   → even an old marker returns nothing, so a non-zero value simply suppresses")
    console.log("     the collections. NOT a usable delta marker on this evidence.")
  } else {
    console.log("\n   → an old marker returns a subset. A delta marker, and a week is inside the window.")
  }
} catch (error) {
  console.log(`   sync <a week ago> → refused: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await old.close()
}

/**
 * All four markers, not two. Presence and drafts were left at `0` in the first run because nothing
 * reads them; the owner asked what happens when they are fed the same marker («2 B»).
 */
console.log("\n2. what do `presenceSync` and `draftsSync` do?\n")

const allFour = new Connection()

try {
  const payload = await login(allFour, serverTime - WEEK, serverTime - WEEK, serverTime - WEEK)
  console.log(`   all four <a week ago> → contacts ${counted(payload, "contacts")}, chats ${counted(payload, "chats")}`)
  console.log(`     presence: ${shape(payload.presence)}`)
  console.log(`     the profile still came back: ${record(payload.profile) ? "yes" : "no"}`)
  console.log(`     fields in the answer: ${Object.keys(payload).join(", ")}`)
} catch (error) {
  console.log(`   all four <a week ago> → refused: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await allFour.close()
}

/**
 * **Can we name everyone in a group?** `#partnerOf` (`src/client.ts:406`) reads `chat.participants`
 * and gives up unless there is exactly one other person, so group members are ignored today.
 *
 * What decides whether that is a one-pass fix: whether `participants` holds *everyone*, or whether
 * MAX truncates it and `participantsCount` is the real size. Counts only below — no ids, no titles.
 */
console.log("\n3. does a chat carry all its participants? (the owner's ask, 2026-09-20)\n")

const groups = new Connection()

try {
  const payload = await login(groups, 0, 0)
  const chats = Array.isArray(payload.chats) ? payload.chats : []
  const everyone = new Set<string>()
  let truncated = 0
  const byKind = new Map<string, { chats: number; listed: number; claimed: number }>()

  for (const raw of chats) {
    const chat = record(raw)
    if (!chat) continue

    const kind = typeof chat.type === "string" ? chat.type : "unknown"
    const listed = Object.keys(record(chat.participants) ?? {})
    const claimed = typeof chat.participantsCount === "number" ? chat.participantsCount : listed.length

    for (const id of listed) everyone.add(id)
    // A channel's `participantsCount` is its subscribers, not a membership we could ever list, so
    // it being larger says nothing about whether MAX truncates a group.
    if (claimed > listed.length && kind !== "CHANNEL") truncated += 1

    const seen = byKind.get(kind) ?? { chats: 0, listed: 0, claimed: 0 }
    byKind.set(kind, { chats: seen.chats + 1, listed: seen.listed + listed.length, claimed: seen.claimed + claimed })
  }

  for (const [kind, seen] of byKind) {
    console.log(
      `   ${kind.padEnd(8)} ${seen.chats} chat(s), ${seen.listed} participant(s) listed, ${seen.claimed} claimed`,
    )
  }

  console.log(`\n   distinct people across every chat: ${everyone.size}`)
  console.log(`   contacts the login named:           ${counted(payload, "contacts")}`)
  console.log(`   groups and dialogs listing fewer than they claim: ${truncated}`)

  if (truncated === 0) {
    console.log("\n   → every group and dialog lists everyone, so naming a whole group is one")
    console.log("     CONTACT_INFO over ids the login already carries. No request per chat.")
    console.log("     A channel is the exception and not a loss: its count is subscribers.")
  } else {
    console.log("\n   → some groups list fewer than they claim: the membership of a big group needs")
    console.log("     its own request, and the login alone cannot name everybody.")
  }
} catch (error) {
  console.log(`   refused: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await groups.close()
}

console.log("\n4. what does opcode 36 answer? (PROTO-1)\n")

/**
 * A short ladder of read-shaped payloads, because an empty one is refused with `proto.payload` —
 * the opcode exists and validates what it is given.
 *
 * Every shape here is one a *list* operation would take. Nothing that names a person, nothing that
 * could be a write. The ladder stops at the first answer: one unknown call is a measurement, a
 * dozen is fishing on somebody's real account.
 */
const SHAPES: { why: string; payload: Record<string, unknown> }[] = [
  { why: "marker, the cursor this protocol uses elsewhere", payload: { marker: 0 } },
  { why: "marker and a count, as `chats.list` takes", payload: { marker: 0, count: 100 } },
  { why: "a count alone", payload: { count: 100 } },
]

const third = new Connection()

try {
  await login(third, 0, 0)

  for (const { why, payload } of SHAPES) {
    try {
      const answer = await third.invoke(36, payload)
      console.log(`   {${Object.keys(payload).join(", ")}} accepted — ${why}`)
      console.log(`     answered: ${shape(answer)}`)
      for (const [key, value] of Object.entries(answer)) console.log(`       ${key}: ${shape(value)}`)
      break
    } catch (error) {
      console.log(`   {${Object.keys(payload).join(", ")}} → ${error instanceof Error ? error.message : String(error)}`)
    }
  }
} catch (error) {
  console.log(`   could not get as far as asking: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await third.close()
}

console.log("\nno names, ids or message text were printed. Record what this says in ARCHITECTURE.md.")
