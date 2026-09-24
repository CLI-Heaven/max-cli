import { CliError } from "@leemour/cli-core"
import * as v from "valibot"
import type { Payload } from "../protocol/frame.js"

/**
 * How much we actually know about a shape.
 *
 * `REQUIREMENTS.md` §10 asks for four levels. There are five, because most of what this CLI sends
 * is stronger than all four of them: we watched MAX answer it. A claim in a README, a line in
 * somebody's source and a frame we captured are three different things, and flattening the third
 * into "confirmed" loses the one distinction the field exists for.
 *
 * The case this has to express: opcode 36 is `CONTACT_LIST` in two clients and `GET_BLOCKED` in
 * the documentation. "Two sources agree" and "one client does this" must not be the same value.
 */
export type Confidence =
  /** We sent it and read the answer. The source says when. */
  | "measured"
  /** Two or more independent implementations agree, and we have not run it. */
  | "confirmed"
  /** One implementation does this. */
  | "observed"
  /** Nobody states it; it follows from something next to it. */
  | "inferred"
  /** Named here so that a gap is recorded rather than implied. */
  | "unknown"

export interface Provenance {
  confidence: Confidence
  /** Where it came from: a file in another project, a document, or a dated measurement. */
  sources: [string, ...string[]]
  /** Anything a reader needs that the sources do not say. */
  notes?: string
}

export interface Operation<
  TRequest extends v.GenericSchema = v.GenericSchema,
  TResponse extends v.GenericSchema = v.GenericSchema,
> {
  readonly kind: "operation"
  /** Dotted and grouped by subject: `chats.list`, `messages.send`. The generator splits on the dot. */
  readonly name: string
  /**
   * MAX's own name for the number, as captured traffic and other clients spell it — `MSG_SEND`,
   * not `MESSAGES_SEND`. Written out rather than derived from `name`, because the two vocabularies
   * are not the same one: ours groups by subject, MAX's has to match what a frame is called
   * everywhere else (`CONVENTIONS.md`, wire names below the adapter).
   */
  readonly constant: string
  readonly opcode: number
  /** Whether it may only be sent after LOGIN. */
  readonly auth: boolean
  /** Strict: a request must not carry a field nobody has seen. */
  readonly request: TRequest
  /** Loose: a response that gained a field must not break a command (§29). */
  readonly response: TResponse
  readonly provenance: Provenance
}

/**
 * A number we know and will not send.
 *
 * Not a `callable: false` flag on an operation, because a reserved opcode has no request shape and
 * half an empty operation invites somebody to fill it in. The generator gives these a registry
 * entry and no method, which is what turns "never call an opcode because it is in the enum" from a
 * rule somebody has to remember into a property of the generated code.
 */
export interface Reservation {
  readonly kind: "reservation"
  readonly name: string
  readonly constant: string
  readonly opcode: number
  /** Why it is known and still never sent. This is the whole value of the entry. */
  readonly reason: string
  readonly provenance: Provenance
}

export type Entry = Operation | Reservation

export const defineOperation = <TRequest extends v.GenericSchema, TResponse extends v.GenericSchema>(
  operation: Omit<Operation<TRequest, TResponse>, "kind">,
): Operation<TRequest, TResponse> => ({ kind: "operation", ...operation })

export const reserveOpcode = (reservation: Omit<Reservation, "kind">): Reservation => ({
  kind: "reservation",
  ...reservation,
})

/** What a caller passes: a domain string for an id, not a `bigint`. */
export type RequestOf<TOperation extends Operation> = v.InferInput<TOperation["request"]>

/** What goes on the wire once the schema has encoded it. */
export type WireRequestOf<TOperation extends Operation> = v.InferOutput<TOperation["request"]>

export type ResponseOf<TOperation extends Operation> = v.InferOutput<TOperation["response"]>

/**
 * Checks and encodes in one step, so a conversion cannot be forgotten in a second place.
 *
 * A refusal here is ours, before anything reaches the socket. **The message names the field and
 * never the value** — a request carries message text, and a validation error is not a place for
 * it to appear.
 */
export const buildRequest = <TOperation extends Operation>(
  operation: TOperation,
  input: RequestOf<TOperation>,
): Payload => {
  const result = v.safeParse(operation.request, input)
  if (result.success) return result.output as Payload

  const fields = closestIssues(operation.request, input, result.issues)
    .map((issue) => fieldPath(issue))
    .join(", ")
  throw new CliError("validation_error", `${operation.name}: cannot send this request — ${fields}`)
}

/**
 * A request with several shapes (`messages.send` is a message or a new group) fails in all of
 * them, and Valibot reports every shape's complaints at once. The shape nearest to what was
 * built is the one its author meant, so only its fields are named.
 */
const closestIssues = (schema: v.GenericSchema, input: unknown, issues: readonly v.BaseIssue<unknown>[]) => {
  if (!("options" in schema) || !Array.isArray(schema.options)) return issues
  const attempts = (schema.options as v.GenericSchema[]).map((option) => v.safeParse(option, input).issues ?? [])
  return attempts.reduce((best, attempt) => (attempt.length < best.length ? attempt : best))
}

/**
 * The dotted path of the field an issue is about, and nothing else.
 *
 * ⚠ **Never `issue.message` and never `issue.received`.** Valibot's own text quotes the value it
 * saw — `Invalid type: Expected number but received "…"` — so printing it puts a message body on
 * the screen and into any log that collects the stream (`REQUIREMENTS.md` §14, §24).
 */
export const fieldPath = (issue: { path?: unknown }): string => {
  const path = Array.isArray(issue.path) ? issue.path : []
  const segments = path.map((step: { key?: unknown }) => String(step?.key ?? "?"))
  return segments.length > 0 ? segments.join(".") : "(the payload itself)"
}
