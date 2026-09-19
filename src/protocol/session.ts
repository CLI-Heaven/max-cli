import type { Connection } from "./connection.js"
import type { Payload } from "./frame.js"

export const Opcode = {
  SESSION_INIT: 6,
  PROFILE: 16,
  LOGIN: 19,
  LOGOUT: 20,
  /**
   * Contact details by id. **Sources disagree about its neighbour**: opcode 36 is `CONTACT_LIST` in
   * tsmax and PyMax, and `GET_BLOCKED` in the protocol documentation. We use 32, which both call the
   * same thing, and stay away from 36 until somebody has watched what it returns.
   */
  CONTACT_INFO: 32,
  CHAT_HISTORY: 49,
  CHATS_LIST: 53,
  MSG_SEND: 64,
} as const

/**
 * What we claim to be. **We imitate MAX's own web client rather than announcing ourselves**
 * (REQUIREMENTS §34), so none of these values names this tool.
 *
 * Shape and field names from `max-api-docs/protocol/auth.md`, cross-checked against tsmax's
 * `createWebAgent`. The device identity is not here: it is generated once per profile and stored,
 * because a client that presents a new device on every command is not imitating anything.
 */
export const WEB_USER_AGENT = {
  deviceType: "WEB",
  pushDeviceType: "WEBPUSH",
  locale: "ru",
  deviceLocale: "ru",
  osVersion: "Linux",
  deviceName: "Chrome",
  headerUserAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  appVersion: "26.5.5",
  screen: "1080x1920 1.0x",
  timezone: "Europe/Madrid",
} as const

export interface SessionOptions {
  token: string
  deviceId: string
  /** How many chats LOGIN should return with the profile. */
  chatsCount?: number
}

/**
 * INIT then LOGIN, in that order, before anything else will be answered
 * (`max-api-docs/protocol/auth.md`).
 *
 * **`interactive` is false.** The web client sends true because a person is looking at it; we are
 * a script reading, and whether that flag moves presence or read state is not settled (`RES-5`).
 * Claiming a human is present when none is, is the kind of small lie that turns into a
 * side effect nobody can trace.
 */
export const startSession = async (
  connection: Connection,
  { token, deviceId, chatsCount = 40 }: SessionOptions,
): Promise<Payload> => {
  await connection.invoke(Opcode.SESSION_INIT, { userAgent: WEB_USER_AGENT, deviceId })

  return await connection.invoke(Opcode.LOGIN, {
    token,
    interactive: false,
    chatsCount,
    chatsSync: 0,
    contactsSync: 0,
    presenceSync: 0,
    draftsSync: 0,
  })
}
