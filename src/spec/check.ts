import * as v from "valibot"
import type { Payload } from "../protocol/frame.js"
import { fieldPath, type Operation } from "./define.js"

/**
 * Compares MAX's answer with what we declared, and **reports without deciding**.
 *
 * Checking is not enforcing. An unofficial protocol changes without telling anyone, so a response
 * never fails a command, never changes an exit code and never alters what the caller gets back
 * (`NEED-35`). Unknown fields are not mismatches at all — response shapes are loose, and a field
 * MAX adds passes straight through.
 *
 * What is left is the case worth hearing about: a field we said we rely on stopped being what it
 * was. The failure this prevents is the quiet one — `max chats` printing a column of blanks
 * because something was renamed, and nobody learning why for a week.
 */
export const checkResponse = (operation: Operation, payload: Payload): string | undefined => {
  try {
    const result = v.safeParse(operation.response, payload)
    if (result.success) return undefined

    const shown = result.issues.slice(0, MOST)
    const rest = result.issues.length - shown.length
    const detail = shown.map(describe).join("; ")

    return `${operation.name}: MAX answered with something we did not expect — ${detail}${
      rest > 0 ? ` (and ${rest} more)` : ""
    }`
  } catch {
    // A diagnostic that breaks the command it was describing is worse than no diagnostic.
    return undefined
  }
}

const MOST = 3

/**
 * ⚠ **Built by hand, never from `issue.message`.** Valibot's own text quotes the value it saw —
 * `Invalid type: Expected number but received "…"` — and the value may be somebody's message. Only
 * the field path, the expected type and the *kind* of what arrived leave this function.
 */
const describe = (issue: { expected?: string | null; input?: unknown; path?: unknown }): string =>
  `${fieldPath(issue)} — expected ${issue.expected ?? "something else"}, got ${kindOf(issue.input)}`

const kindOf = (value: unknown): string => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "a list"
  return typeof value
}
