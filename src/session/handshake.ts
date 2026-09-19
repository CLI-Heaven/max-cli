import type { Invoke } from "../generated/client.generated.js"
import type { Payload } from "../protocol/frame.js"
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
 *
 * **It is handed the client's own `invoke` rather than the socket**, so INIT and LOGIN are built,
 * checked and reported exactly like every other request. They were not, until 2026-09-20: a
 * diagnostic hook in `MaxClient` saw nothing of the two requests every single invocation makes,
 * and `max chats list` answers from the LOGIN response without sending anything else.
 */
export const startSession = async (
  invoke: Invoke,
  { token, deviceId, chatsCount = 40 }: SessionOptions,
): Promise<Payload> => {
  await invoke(sessionInit, { userAgent: WEB_USER_AGENT, deviceId })

  return await invoke(sessionLogin, {
    token,
    // A script reading is not a person looking; see the specification for why this is never true.
    interactive: false,
    chatsCount,
    chatsSync: 0,
    contactsSync: 0,
    presenceSync: 0,
    draftsSync: 0,
  })
}
