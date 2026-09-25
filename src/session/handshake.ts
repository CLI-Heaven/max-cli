import type { Invoke } from "../generated/client.generated.js"
import type { Payload } from "../protocol/frame.js"
import { WEB_USER_AGENT } from "../spec/identity.js"
import { sessionInit, sessionLogin } from "../spec/operations/session.js"

export interface SessionOptions {
  token: string
  deviceId: string
  /** How many chats LOGIN should return with the profile. The specification caps it at 100. */
  chatsCount?: number
  /**
   * The `time` the previous login answered with, or `0` for "send me everything".
   *
   * **The four markers are moments, not flags** — measured 2026-09-20. MAX returns only what
   * changed in each collection since the one given, so a stored marker is the difference between
   * re-fetching every chat and every contact on every invocation and receiving the handful that
   * moved. Where it is kept, and why the merge and the marker share a transaction, is
   * `docs/dev/architecture/session.md`.
   *
   * **Only `contactsSync` carries it** — correction 2026-09-25: this said all four carry the same
   * value, measured harmless over JSON (`NEED-103`). Over the binary protocol MAX refused a login
   * with the time in all four (`proto.payload`, `FIND-162`), and web.max.ru sends a 64-bit time in
   * `contactsSync` alone, small numbers in the other three. We send 0 there.
   */
  sync?: number
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
/** How many chats LOGIN is asked for. MAX answers the newest that many, newest first (`FIND-80`). */
export const LOGIN_CHATS = 40

export const startSession = async (
  invoke: Invoke,
  { token, deviceId, chatsCount = LOGIN_CHATS, sync = 0 }: SessionOptions,
): Promise<Payload> => {
  await invoke(sessionInit, { userAgent: WEB_USER_AGENT, deviceId })

  return await invoke(sessionLogin, {
    token,
    // A script reading is not a person looking; see the specification for why this is never true.
    interactive: false,
    chatsCount,
    chatsSync: 0,
    contactsSync: sync,
    presenceSync: 0,
    draftsSync: 0,
  })
}
