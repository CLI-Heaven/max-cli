// Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`.

import { attachmentsFile, attachmentsVideo } from "../spec/operations/attachments.js"
import { chatsHistory, chatsList } from "../spec/operations/chats.js"
import { contactsInfo } from "../spec/operations/contacts.js"
import {
  loginByQr,
  loginPassword,
  loginQrRequest,
  loginQrStatus,
  loginSmsCode,
  loginSmsRequest,
} from "../spec/operations/login.js"
import { messagesReact, messagesReactions, messagesSend, messagesUnreact } from "../spec/operations/messages.js"
import { sessionInit, sessionLogin } from "../spec/operations/session.js"
import { uploadsFile, uploadsPhoto } from "../spec/operations/uploads.js"

/** Every operation that may be sent, by the name the client calls it. */
export const OPERATIONS = {
  "session.init": sessionInit,
  "session.login": sessionLogin,
  "login.qrRequest": loginQrRequest,
  "login.qrStatus": loginQrStatus,
  "login.byQr": loginByQr,
  "login.smsRequest": loginSmsRequest,
  "login.smsCode": loginSmsCode,
  "login.password": loginPassword,
  "contacts.info": contactsInfo,
  "chats.history": chatsHistory,
  "chats.list": chatsList,
  "messages.send": messagesSend,
  "messages.react": messagesReact,
  "messages.unreact": messagesUnreact,
  "messages.reactions": messagesReactions,
  "attachments.video": attachmentsVideo,
  "attachments.file": attachmentsFile,
  "uploads.photo": uploadsPhoto,
  "uploads.file": uploadsFile,
} as const

export type OperationName = keyof typeof OPERATIONS
