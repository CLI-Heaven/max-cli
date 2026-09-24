import type { Entry, Operation, Reservation } from "./define.js"
import { attachmentsFile, attachmentsVideo } from "./operations/attachments.js"
import { chatMark, chatsHistory, chatsList } from "./operations/chats.js"
import { contactsInfo, profile, unidentified36 } from "./operations/contacts.js"
import { messageDelete, messagesReact, messagesReactions, messagesSend } from "./operations/messages.js"
import { logout, sessionInit, sessionLogin } from "./operations/session.js"

export { checkResponse } from "./check.js"
export * from "./define.js"
export * from "./scalars.js"

/**
 * Every opcode this project knows, whether or not it is ever sent.
 *
 * **The order is the order it is read in**, and the generator preserves it: the registry, the
 * reference table and the coverage list all come out grouped the same way, which is what makes a
 * regenerated file a small diff instead of a reshuffle.
 */
export const spec: readonly Entry[] = [
  sessionInit,
  sessionLogin,
  logout,
  contactsInfo,
  profile,
  unidentified36,
  chatsHistory,
  chatMark,
  chatsList,
  messagesSend,
  messagesReact,
  messagesReactions,
  messageDelete,
  attachmentsVideo,
  attachmentsFile,
]

export const operations: readonly Operation[] = spec.filter((entry): entry is Operation => entry.kind === "operation")

export const reservations: readonly Reservation[] = spec.filter(
  (entry): entry is Reservation => entry.kind === "reservation",
)
