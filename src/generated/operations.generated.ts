// Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`.

import { chatsHistory, chatsList } from "../spec/operations/chats.js"
import { contactsInfo } from "../spec/operations/contacts.js"
import { messagesSend } from "../spec/operations/messages.js"
import { sessionInit, sessionLogin } from "../spec/operations/session.js"

/** Every operation that may be sent, by the name the client calls it. */
export const OPERATIONS = {
  "session.init": sessionInit,
  "session.login": sessionLogin,
  "contacts.info": contactsInfo,
  "chats.history": chatsHistory,
  "chats.list": chatsList,
  "messages.send": messagesSend,
} as const

export type OperationName = keyof typeof OPERATIONS
