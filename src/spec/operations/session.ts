import * as v from "valibot"
import { defineOperation, reserveOpcode } from "../define.js"

/**
 * What we claim to be, as a shape rather than a constant.
 *
 * Declaring it strictly is the point: every field here is one the official web client sends
 * (`REQUIREMENTS.md` §34), and a field we invented would be refused before it reached the socket.
 */
const WebUserAgent = v.strictObject({
  deviceType: v.literal("WEB"),
  pushDeviceType: v.literal("WEBPUSH"),
  locale: v.string(),
  deviceLocale: v.string(),
  osVersion: v.string(),
  deviceName: v.string(),
  headerUserAgent: v.string(),
  appVersion: v.string(),
  screen: v.string(),
  timezone: v.string(),
})

export const sessionInit = defineOperation({
  name: "session.init",
  constant: "SESSION_INIT",
  opcode: 6,
  auth: false,
  request: v.strictObject({ userAgent: WebUserAgent, deviceId: v.string() }),
  response: v.looseObject({}),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-19", "max-api-docs/protocol/auth.md", "tsmax createWebAgent"],
    notes: "MAX answers nothing before this and LOGIN, in that order.",
  },
})

export const sessionLogin = defineOperation({
  name: "session.login",
  constant: "LOGIN",
  opcode: 19,
  auth: false,
  request: v.strictObject({
    token: v.string(),
    /**
     * False, always. The web client sends true because a person is looking at it; we are a script
     * reading, and claiming a human is present is the small lie that becomes a side effect nobody
     * can trace (`RES-5`).
     */
    interactive: v.literal(false),
    // 100 works and 200 comes back `'chatsCount' out of range`; refusing locally beats a round
    // trip that only tells us what we already know. The real boundary is `PROTO-3`.
    chatsCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
    chatsSync: v.number(),
    contactsSync: v.number(),
    presenceSync: v.number(),
    draftsSync: v.number(),
  }),
  response: v.looseObject({
    profile: v.optional(v.looseObject({})),
    chats: v.optional(v.array(v.looseObject({}))),
    contacts: v.optional(v.array(v.looseObject({}))),
    messages: v.optional(v.array(v.looseObject({}))),
    presence: v.optional(v.unknown()),
    time: v.optional(v.number()),
    chatMarker: v.optional(v.unknown()),
    config: v.optional(v.unknown()),
    videoChatHistory: v.optional(v.unknown()),
  }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-19"],
    notes:
      "Unusually generous: the answer carries the profile, chats, contacts and recent messages, so `me` and `chats` need no further request.",
  },
})

export const logout = reserveOpcode({
  name: "session.logout",
  constant: "LOGOUT",
  opcode: 20,
  reason:
    "`max session end` forgets the token locally and tells MAX nothing. Ending the session server-side would also end it for the browser tab the token came from, which is not what the command promises.",
  provenance: { confidence: "observed", sources: ["max-api-docs/protocol/auth.md"] },
})
