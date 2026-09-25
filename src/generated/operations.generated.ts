// Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`.

import { accountCloseSessions, accountSessions, accountUpdate } from "../spec/operations/account.js"
import { attachmentsFile, attachmentsVideo } from "../spec/operations/attachments.js"
import {
  chatsHistory,
  chatsJoin,
  chatsLeave,
  chatsLinkInfo,
  chatsList,
  chatsMark,
  chatsMembers,
  chatsUpdate,
  chatsUpdateMembers,
} from "../spec/operations/chats.js"
import { contactsByPhone, contactsImport, contactsInfo, contactsUpdate } from "../spec/operations/contacts.js"
import { foldersDelete, foldersList, foldersUpdate } from "../spec/operations/folders.js"
import {
  loginByQr,
  loginPassword,
  loginQrRequest,
  loginQrStatus,
  loginSmsCode,
  loginSmsRequest,
} from "../spec/operations/login.js"
import {
  messagesDelete,
  messagesEdit,
  messagesReact,
  messagesReactions,
  messagesSend,
  messagesUnreact,
} from "../spec/operations/messages.js"
import { sessionInit, sessionLog, sessionLogin, sessionPing } from "../spec/operations/session.js"
import { uploadsFile, uploadsPhoto } from "../spec/operations/uploads.js"

/** Every operation that may be sent, by the name the client calls it. */
export const OPERATIONS = {
  "session.init": sessionInit,
  "session.login": sessionLogin,
  "session.ping": sessionPing,
  "session.log": sessionLog,
  "login.qrRequest": loginQrRequest,
  "login.qrStatus": loginQrStatus,
  "login.byQr": loginByQr,
  "login.smsRequest": loginSmsRequest,
  "login.smsCode": loginSmsCode,
  "login.password": loginPassword,
  "contacts.info": contactsInfo,
  "contacts.byPhone": contactsByPhone,
  "contacts.update": contactsUpdate,
  "contacts.import": contactsImport,
  "account.update": accountUpdate,
  "account.sessions": accountSessions,
  "account.closeSessions": accountCloseSessions,
  "folders.list": foldersList,
  "folders.update": foldersUpdate,
  "folders.delete": foldersDelete,
  "chats.history": chatsHistory,
  "chats.mark": chatsMark,
  "chats.list": chatsList,
  "chats.linkInfo": chatsLinkInfo,
  "chats.join": chatsJoin,
  "chats.leave": chatsLeave,
  "chats.update": chatsUpdate,
  "chats.members": chatsMembers,
  "chats.updateMembers": chatsUpdateMembers,
  "messages.send": messagesSend,
  "messages.edit": messagesEdit,
  "messages.react": messagesReact,
  "messages.unreact": messagesUnreact,
  "messages.reactions": messagesReactions,
  "messages.delete": messagesDelete,
  "attachments.video": attachmentsVideo,
  "attachments.file": attachmentsFile,
  "uploads.photo": uploadsPhoto,
  "uploads.file": uploadsFile,
} as const

export type OperationName = keyof typeof OPERATIONS
