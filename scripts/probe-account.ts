/**
 * The shapes behind `MAX-32` and `MAX-33`. Run by hand, never by CI.
 *
 *   pnpm probe:account           # reads only: folders, sessions, the own profile
 *   pnpm probe:account --write   # also what the owner allowed (`NEED-203`, `NEED-204`)
 *
 * `--write` looks the owner's own number up (46), imports it (21), rewrites the profile with the
 * values it already has (16), and creates, renames and deletes a folder "max-cli probe" (274, 276).
 * Nothing else is written, and `SESSIONS_CLOSE` (97) is never sent (`NEED-202`).
 *
 * **It prints no content**: field paths with their value types, and short upper-case codes. Never a
 * name, a number, an id, an address or a title.
 */
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest, type Operation } from "../dist/spec/define.js"
import { accountSessions, accountUpdate } from "../dist/spec/operations/account.js"
import { contactsByPhone, contactsImport } from "../dist/spec/operations/contacts.js"
import { foldersDelete, foldersList, foldersUpdate } from "../dist/spec/operations/folders.js"

const write = process.argv.includes("--write")

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

type Payload = Record<string, unknown>

const record = (value: unknown): Payload | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : undefined

const typeOf = (value: unknown): string => {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

const code = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Z][A-Z_]{0,31}$/.test(value) ? value : undefined

const shape = (label: string, value: unknown): void => {
  const paths = new Map<string, Set<string>>()
  const walk = (inner: unknown, path: string): void => {
    const seen = paths.get(path) ?? new Set<string>()
    const printable = /(name|title|description|link|phone|location|ip)$/i.test(path) ? undefined : code(inner)
    seen.add(printable ? `${typeOf(inner)} ${printable}` : typeOf(inner))
    paths.set(path, seen)
    if (Array.isArray(inner)) for (const item of inner) walk(item, `${path}[]`)
    else
      for (const [key, next] of Object.entries(record(inner) ?? {}))
        walk(next, `${path}.${/\d{5}/.test(key) ? "<phone>" : key}`)
  }
  walk(value, "")
  console.log(`\n${label}`)
  for (const [path, types] of [...paths].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`  ${path || "(root)"}: ${[...types].join(" | ")}`)
}

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

const attempt = async (label: string, operation: Operation, request: unknown): Promise<Payload | undefined> => {
  try {
    const answer = await connection.invoke(operation.opcode, buildRequest(operation, request as never))
    shape(`${label} — ${operation.constant} (${operation.opcode}) answered`, answer)
    return answer
  } catch (error) {
    const payload = record((error as { payload?: unknown }).payload)
    console.log(`\n${label} — ${operation.constant} (${operation.opcode}) refused: ${String(payload?.error ?? error)}`)
    return undefined
  }
}

try {
  await connection.open()
  const login = await startSession(invoke, { token, deviceId: store.readState().deviceId })
  // Dropping an exchanged token may be what logged the default profile out three times on 2026-09-24 (`RISK-17`).
  const exchanged = typeof login.token === "string" && login.token !== "" && login.token !== token
  if (exchanged) store.writeToken(login.token as string)
  console.log(`LOGIN answered with a replacement token: ${exchanged ? "yes, saved" : "no"}`)
  const profile = record(login.profile) ?? {}
  const contact = record(profile.contact) ?? {}
  const ownId = asId(contact.id)
  shape("LOGIN profile", profile)
  const settings = record(record(login.config)?.server) ?? record(login.config) ?? {}
  for (const [key, value] of Object.entries(settings))
    if (/folder|profile|description|name/i.test(key) && typeof value !== "object")
      console.log(`  config ${key}: ${String(value)}`)

  const folders = await attempt("folders", foldersList, { folderSync: 0 })
  for (const folder of (Array.isArray(folders?.folders) ? folders.folders : []).map(record)) {
    const id = String(folder?.id ?? "")
    const kind = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id) ? "uuid" : /^\d+$/.test(id) ? "number" : "other string"
    console.log(`  folder id: ${kind}, ${Array.isArray(folder?.include) ? folder.include.length : "no"} chats included`)
  }

  const sessions = await attempt("sessions", accountSessions, {})
  const list = (Array.isArray(sessions?.sessions) ? sessions.sessions : []).map(record)
  console.log(`  ${list.length} sessions, ${list.filter((one) => one?.current === true).length} marked current`)
  console.log(`  session time digits: ${list.map((one) => String(one?.time ?? "").length).join(", ")}`)

  if (write) {
    const names = (Array.isArray(contact.names) ? contact.names : []).map(record)
    const own = names.find((one) => one?.type === "ONEME") ?? names[0] ?? {}
    const firstName = typeof own.firstName === "string" ? own.firstName : undefined
    const lastName = typeof own.lastName === "string" ? own.lastName : undefined
    const phone =
      typeof contact.phone === "string" || typeof contact.phone === "number" ? String(contact.phone) : undefined
    console.log(
      `\nown profile: firstName ${firstName ? "found" : "missing"}, lastName ${lastName ? "found" : "missing"}, phone ${phone ? "found" : "missing"}`,
    )

    if (phone) {
      const found = await attempt("lookup by own number", contactsByPhone, { phone: `+${phone.replace(/^\+/, "")}` })
      console.log(`  the contact returned is the owner: ${asId(record(found?.contact)?.id) === ownId}`)
      const imported = await attempt("import own number", contactsImport, {
        contactList: { [`+${phone.replace(/^\+/, "")}`]: { firstName: firstName ?? "probe" } },
      })
      const ids = (Array.isArray(imported?.contacts) ? imported.contacts : []).map((one) => asId(record(one)?.id))
      console.log(`  ${ids.length} contacts returned, the owner among them: ${ids.includes(ownId)}`)
    }

    if (firstName) {
      const description = typeof contact.description === "string" ? contact.description : undefined
      await attempt("profile rewritten with its own values", accountUpdate, {
        firstName,
        ...(lastName === undefined ? {} : { lastName }),
        ...(description === undefined ? {} : { description }),
      })
    }

    const id = crypto.randomUUID()
    const created = await attempt("folder created", foldersUpdate, {
      id,
      title: "max-cli probe",
      include: [],
      filters: [],
      options: [],
    })
    if (created) {
      const folder = record(created.folder) ?? {}
      console.log(`  the folder kept the id we gave it: ${folder.id === id}`)
      await attempt("folder renamed", foldersUpdate, {
        id,
        title: "max-cli probe 2",
        include: [],
        filters: Array.isArray(folder.filters) ? folder.filters : [],
        options: Array.isArray(folder.options) ? folder.options : [],
      })
      await attempt("folder deleted", foldersDelete, { folderIds: [id] })
      const after = await attempt("folders after", foldersList, { folderSync: 0 })
      const left = (Array.isArray(after?.folders) ? after.folders : []).some((one) => record(one)?.id === id)
      console.log(`  the probe folder is still there: ${left}`)
    }
  }
} finally {
  await connection.close()
}
