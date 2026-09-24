import type { Entry, Operation, Reservation } from "./define.js"
import { attachmentsFile, attachmentsVideo } from "./operations/attachments.js"
import {
  chatDelete,
  chatMark,
  chatsHistory,
  chatsJoin,
  chatsLeave,
  chatsLinkInfo,
  chatsList,
  chatsMembers,
  chatsUpdate,
  chatsUpdateMembers,
} from "./operations/chats.js"
import { contactsInfo, profile, unidentified36 } from "./operations/contacts.js"
import {
  loginByQr,
  loginPassword,
  loginQrRequest,
  loginQrStatus,
  loginSmsCode,
  loginSmsRequest,
  qrApprove,
} from "./operations/login.js"
import {
  messageDelete,
  messagesEdit,
  messagesReact,
  messagesReactions,
  messagesSend,
  messagesUnreact,
} from "./operations/messages.js"
import { logout, sessionInit, sessionLogin } from "./operations/session.js"
import { uploadsFile, uploadsPhoto } from "./operations/uploads.js"

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
  loginQrRequest,
  loginQrStatus,
  loginByQr,
  qrApprove,
  loginSmsRequest,
  loginSmsCode,
  loginPassword,
  contactsInfo,
  profile,
  unidentified36,
  chatsHistory,
  chatMark,
  chatsList,
  chatsLinkInfo,
  chatsJoin,
  chatsLeave,
  chatsUpdate,
  chatsMembers,
  chatsUpdateMembers,
  chatDelete,
  messagesSend,
  messagesEdit,
  messagesReact,
  messagesUnreact,
  messagesReactions,
  messageDelete,
  attachmentsVideo,
  attachmentsFile,
  uploadsPhoto,
  uploadsFile,
]

export const operations: readonly Operation[] = spec.filter((entry): entry is Operation => entry.kind === "operation")

export const reservations: readonly Reservation[] = spec.filter(
  (entry): entry is Reservation => entry.kind === "reservation",
)
