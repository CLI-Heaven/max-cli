import type { Connection } from "../protocol/connection.js"
import type { Payload } from "../protocol/frame.js"
import { buildRequest } from "../spec/define.js"
import { WEB_USER_AGENT } from "../spec/identity.js"
import { sessionInit, sessionLogin } from "../spec/operations/session.js"

export interface SessionOptions {
  token: string
  deviceId: string
  /** How many chats LOGIN should return with the profile. The specification caps it at 100. */
  chatsCount?: number
}

/**
 * INIT then LOGIN, in that order, before anything else will be answered
 * (`max-api-docs/protocol/auth.md`).
 *
 * **Handwritten, and staying that way** (`REQUIREMENTS.md` §9): a socket problem has to be
 * debuggable without reading a generator. What the specification supplies is the two payloads, so
 * the field names have one home rather than two.
 *
 * It lives here rather than under `protocol/` because it is not transport: the transport moves
 * frames and does not care who is asking. Establishing a session is this layer's job.
 */
export const startSession = async (
  connection: Connection,
  { token, deviceId, chatsCount = 40 }: SessionOptions,
): Promise<Payload> => {
  await connection.invoke(sessionInit.opcode, buildRequest(sessionInit, { userAgent: WEB_USER_AGENT, deviceId }))

  return await connection.invoke(
    sessionLogin.opcode,
    buildRequest(sessionLogin, {
      token,
      // A script reading is not a person looking; see the specification for why this is never true.
      interactive: false,
      chatsCount,
      chatsSync: 0,
      contactsSync: 0,
      presenceSync: 0,
      draftsSync: 0,
    }),
  )
}
