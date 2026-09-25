import type { Payload } from "../protocol/frame.js"

/**
 * One request, as both sinks see it: `--trace` renders it, the run log writes it as a line of
 * JSON. **One object, two sinks** — a second shape for one of them is how the two start disagreeing
 * about what happened.
 *
 * ⚠ **Nothing here may carry content.** The operation, the opcode, the `seq`, the ids a request
 * named, byte counts and durations are safe: an id is opaque and can only be correlated by whoever
 * already has the session. A chat title, a person's name, a message body, a phone number or a token
 * are not — not truncated and not hashed (`REQUIREMENTS.md` §14, §24). The fields below are the
 * whole vocabulary, and `idsOf` builds them from named fields rather than filtering a copy of the
 * payload, so there is no path by which an unforeseen field arrives here.
 */
export interface RequestEvent {
  event: "request" | "response"
  /** Ours, not MAX's: `chats.history`, not `CHAT_HISTORY`. */
  operation: string
  opcode: number
  seq: number
  /** The frame that went out, or the one that came back. Absent when nothing came back. */
  bytes?: number
  /** Which things the request named — `{ chat: "0" }`. Never how they are called. */
  ids?: Record<string, string>
  /** How many things, per field: `{ messages: 3 }`. A field name and a length carry no content. */
  counts?: Record<string, number>
  durationMs?: number
  outcome?: "ok" | "error"
  /** `cli-core`'s code — `timeout`, `provider_error`. Never the message: MAX quotes our payload. */
  errorCode?: string
  /** MAX's own key for a refusal — `login.token`, `proto.payload` — and only if it is shaped like one (`maxErrorKey`). */
  maxError?: string
}

/**
 * Something the client noticed and went on without — reactions it could not read, a response of an
 * unexpected shape. **A code, never the sentence**: the sentence quotes MAX, and MAX quotes us.
 */
export interface WarningEvent {
  event: "warning"
  code: WarningCode
  operation?: string
  /** Only for `response_shape`: field paths and types, built without the values (`src/spec/check.ts`). */
  detail?: string
}

export type WarningCode =
  | "chats_partial"
  | "token_not_saved"
  | "cache_not_written"
  | "reactions_unread"
  | "names_unread"
  | "response_shape"

/**
 * A read that never reached MAX.
 *
 * It is not a request and must not be shaped like one — there is no opcode, no `seq` and no frame,
 * and calling a local answer "request 0 bytes" would put a fiction in the record. The call sites
 * belong to the cache (`MAX-7`); what lives here is the vocabulary, so that the two of them cannot
 * drift into two shapes for one diagnostic.
 */
export interface CacheEvent {
  event: "cache"
  /** Ours: `chats.list`, `messages.list`. */
  operation: string
  reason: CacheReason
  ids?: Record<string, string>
  counts?: Record<string, number>
  /** How old the local answer was. The number a person wants when a list looks wrong. */
  ageMs?: number
}

/**
 * Why MAX was not asked. **"We did not ask" and "there was nothing to ask" are different events**,
 * and only the second is the record doing its job rather than standing in for a connection.
 *
 * Written out as two words rather than a free string so that the vocabulary has one home and a
 * third case has to be added here, deliberately, instead of appearing in a log nobody can group.
 */
export type CacheReason =
  /** The caller said never connect, so the record is all there is. */
  | "offline"
  /** The window asked for is older than a fetch would return, so the record is authoritative. */
  | "history"

/** What either sink is handed. One object, two sinks — see `RequestEvent`. */
export type DiagnosticEvent = RequestEvent | CacheEvent | WarningEvent

/**
 * MAX's refusal as a key, or nothing. Every refusal seen so far is a dotted key — `proto.payload`,
 * `login.token`, `folder.validation.title.too-long` — and a key carries no content. Anything else,
 * a sentence or a quote, is dropped rather than trimmed.
 */
export const maxErrorKey = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-z][a-z0-9._-]{0,63}$/.test(value) ? value : undefined

/**
 * The ids a request named, by name, from a list of fields that is written out here.
 *
 * **An allowlist, never a filter.** Copying the request and removing what looks dangerous means a
 * field nobody has seen yet arrives in the log by default; this way it cannot. `token` is the case
 * that matters: it is a field of `session.login` and there is no branch here that could reach it.
 */
export const idsOf = (request: unknown): { ids?: Record<string, string>; counts?: Record<string, number> } => {
  if (!isRecord(request)) return {}

  const ids: Record<string, string> = {}
  const counts: Record<string, number> = {}

  if (isId(request.chatId)) ids.chat = String(request.chatId)
  if (isId(request.messageId)) ids.message = String(request.messageId)
  if (typeof request.cid === "number") ids.cid = String(request.cid)

  // `messages.send` carries its client id one level down, and the `cid` is the one thing that makes
  // an ambiguous send repeatable — see `MaxClient.messages.send`.
  const message = isRecord(request.message) ? request.message : undefined
  if (message && typeof message.cid === "number") ids.cid = String(message.cid)

  if (Array.isArray(request.contactIds)) counts.contacts = request.contactIds.length

  return {
    ...(Object.keys(ids).length > 0 ? { ids } : {}),
    ...(Object.keys(counts).length > 0 ? { counts } : {}),
  }
}

/**
 * How many of each list MAX sent back — `{ chats: 25, contacts: 6 }`.
 *
 * Every array at the top of the answer, counted. Generic on purpose: a per-operation table of
 * "which field is the interesting one" is a second registry to keep in step with `src/spec/`, and
 * a field name with a length beside it is content-free whatever MAX adds next.
 */
export const countsIn = (payload: Payload): Record<string, number> | undefined => {
  const counts: Record<string, number> = {}
  for (const [field, value] of Object.entries(payload)) if (Array.isArray(value)) counts[field] = value.length
  return Object.keys(counts).length > 0 ? counts : undefined
}

/**
 * The line a person reads. `→` is what we asked, `←` what came back, `•` what never left.
 *
 * ```text
 * → chats.history    op 49  seq 3  chat 0
 * ← chats.history    op 49  seq 3  118ms  4.2 kB  3 messages
 * • chats.list       offline  cached 42s  25 chats
 * ```
 */
export const renderEvent = (event: DiagnosticEvent): string => {
  if (event.event === "warning") {
    return [`${MARK.warning} ${(event.operation ?? "").padEnd(16)} ${event.code}`, event.detail]
      .filter(Boolean)
      .join("  ")
  }
  const parts: string[] = []

  if (event.event === "cache") {
    parts.push(event.reason)
    if (event.ageMs !== undefined) parts.push(`cached ${age(event.ageMs)}`)
  } else {
    parts.push(`op ${event.opcode}`, `seq ${event.seq}`)
  }

  if (event.ids) for (const [name, value] of Object.entries(event.ids)) parts.push(`${name} ${value}`)

  if (event.event !== "cache") {
    if (event.durationMs !== undefined) parts.push(`${event.durationMs}ms`)
    if (event.bytes !== undefined) parts.push(size(event.bytes))
  }

  if (event.counts) for (const [field, count] of Object.entries(event.counts)) parts.push(`${count} ${field}`)
  if (event.event !== "cache" && event.errorCode) parts.push(event.errorCode)
  if (event.event !== "cache" && event.maxError) parts.push(event.maxError)

  return `${MARK[event.event]} ${event.operation.padEnd(16)} ${parts.join("  ")}`
}

const MARK = { request: "\u2192", response: "\u2190", cache: "\u2022", warning: "!" } as const

const age = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`)

const size = (bytes: number): string => (bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is string | number | bigint =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
