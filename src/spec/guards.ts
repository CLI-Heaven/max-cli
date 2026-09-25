import { CliError } from "@leemour/cli-core"
import { asId, type Payload } from "../protocol/frame.js"

/**
 * The chat a guarded request goes to. **Missing is a refusal, never `null`**: a `null` chat skips
 * the recipient list, so only the shapes that create or join a chat may have one.
 */
export const chatOf = (request: Payload, field = "chatId"): string => {
  const chatId = asId(request[field])
  if (chatId === undefined) throw new CliError("validation_error", `a guarded request without its ${field}`)
  return chatId
}

export const messageOf = (request: Payload, field = "messageId"): { messageId?: string } => {
  const messageId = asId(request[field])
  return messageId === undefined ? {} : { messageId }
}

export const objectOf = (value: unknown): Payload =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : {}

export const countOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

/** A request that could be read as two different changes is refused rather than guarded as one of them. */
export const ambiguous = (operation: string): never => {
  throw new CliError("validation_error", `${operation}: one change per request`)
}
