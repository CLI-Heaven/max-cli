import type { Entry, Operation, Reservation } from "./define.js"
import { accountCloseSessions, accountSessions, accountUpdate } from "./operations/account.js"
import { attachmentsFile, attachmentsVideo } from "./operations/attachments.js"
import {
  chatDelete,
  chatsHistory,
  chatsJoin,
  chatsLeave,
  chatsLinkInfo,
  chatsList,
  chatsMark,
  chatsMembers,
  chatsUpdate,
  chatsUpdateMembers,
} from "./operations/chats.js"
import { contactsByPhone, contactsImport, contactsInfo, contactsUpdate, unidentified36 } from "./operations/contacts.js"
import { foldersDelete, foldersList, foldersUpdate } from "./operations/folders.js"
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
  messagesDelete,
  messagesEdit,
  messagesReact,
  messagesReactions,
  messagesSend,
  messagesUnreact,
} from "./operations/messages.js"
import { logout, sessionInit, sessionLogin, sessionPing } from "./operations/session.js"
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
  sessionPing,
  logout,
  loginQrRequest,
  loginQrStatus,
  loginByQr,
  qrApprove,
  loginSmsRequest,
  loginSmsCode,
  loginPassword,
  contactsInfo,
  contactsByPhone,
  contactsUpdate,
  contactsImport,
  unidentified36,
  accountUpdate,
  accountSessions,
  accountCloseSessions,
  foldersList,
  foldersUpdate,
  foldersDelete,
  chatsHistory,
  chatsMark,
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
  messagesDelete,
  attachmentsVideo,
  attachmentsFile,
  uploadsPhoto,
  uploadsFile,
]

export const operations: readonly Operation[] = spec.filter((entry): entry is Operation => entry.kind === "operation")

export const reservations: readonly Reservation[] = spec.filter(
  (entry): entry is Reservation => entry.kind === "reservation",
)
