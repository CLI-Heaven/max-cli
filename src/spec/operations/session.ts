import * as v from "valibot"
import { defineOperation, reserveOpcode } from "../define.js"
import { id } from "../scalars.js"

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
  isPwa: v.literal(false),
  appVersion: v.string(),
  screen: v.string(),
  timezone: v.string(),
})

/**
 * **The keep-alive, which only `max serve` sends** — a one-shot command is gone long before it
 * would matter. `interactive` is whether the tab is visible; ours is never, as LOGIN's is.
 */
export const sessionPing = defineOperation({
  name: "session.ping",
  constant: "PING",
  opcode: 1,
  auth: true,
  request: v.strictObject({ interactive: v.boolean() }),
  response: v.looseObject({}),
  provenance: {
    confidence: "confirmed",
    sources: ["web.max.ru bundle read 2026-09-24: `cmd(1, {interactive})` every 30 s", "PyMax Opcode.PING = 1"],
    notes: "MAX pings too; `Connection` answers those itself when it is live.",
  },
})

/**
 * **Telemetry, and only the one event a hidden web tab sends** (`MAX-8`): the chat list shown,
 * 20 s after the tab opened. A one-shot command never sends it — a hidden tab closed that soon
 * sends nothing either. Why exactly this and nothing more: `docs/dev/capture/requirements.md`.
 *
 * The request is strict and literal on purpose: anything beyond this one event claims a person in
 * front of a visible tab, which is a different decision.
 */
export const sessionLog = defineOperation({
  name: "session.log",
  constant: "LOG",
  opcode: 5,
  auth: true,
  request: v.strictObject({
    events: v.array(
      v.strictObject({
        type: v.literal("NAV"),
        userId: id(),
        time: v.number(),
        sessionId: v.number(),
        event: v.literal("GO"),
        params: v.strictObject({
          action_id: v.literal(1),
          screen_to: v.literal(150),
          prev_time: v.literal(0),
          source_id: id(),
        }),
      }),
    ),
  }),
  response: v.looseObject({}),
  provenance: {
    confidence: "observed",
    sources: [
      "web.max.ru frames captured 2026-09-25 (docs/dev/capture/2026-09-25-web-tab.md): a hidden tab's only event, answered with an empty body",
      "ids wrapped in extension 1 and times plain: inferred from the frame's unpacked size, 144 bytes, which only that encoding gives",
    ],
  },
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
    // 100 works and 200 comes back `'chatsCount' out of range`; refusing locally beats a round
    // trip that only tells us what we already know. The real boundary is `PROTO-3`.
    chatsCount: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
    /**
     * False, always: we are a script reading, and claiming a human is present is the small lie that
     * becomes a side effect nobody can trace (`RES-5`). **Correction 2026-09-25:** this said the web
     * client sends true; its LOGIN on a live socket sent `false` too — `true` goes in its pings.
     */
    interactive: v.literal(false),
    /**
     * **Delta markers, not flags** — measured 2026-09-20. Each is a moment in time, and MAX
     * returns only what changed in that collection since it. `0` means "everything", which is what
     * `src/session/handshake.ts` sends and is why every command re-fetches the whole list.
     *
     * The measurement, on a real account: `0` returned 6 contacts and 25 chats; the `time` the
     * previous login answered with returned 0 and 0; a week earlier returned 1 and 11. The last of
     * those is the one that matters — without it, "nothing came back" would equally have meant
     * "any non-zero value suppresses the collection".
     *
     * Feeding them back is `MAX-10`, and it needs somewhere to keep the marker per profile.
     */
    chatsSync: v.number(),
    contactsSync: v.number(),
    presenceSync: v.number(),
    draftsSync: v.number(),
  }),
  response: v.looseObject({
    profile: v.optional(v.looseObject({})),
    chats: v.optional(v.array(v.looseObject({}))),
    contacts: v.optional(v.array(v.looseObject({}))),
    /**
     * ⚠ **Shape unknown, and this field is why the response check exists.**
     *
     * It was declared as an array here and MAX sends an **object** — found 2026-09-20 by routing
     * the handshake through the checked path. Nothing broke, because the reader is tolerant; what
     * happened instead is that every message the login carries has been silently discarded since
     * the specification was written, after we paid a request for them.
     *
     * The reference documents no top-level `messages` on this response at all — each chat carries
     * its own `lastMessage` (`max-api-docs/protocol/chats.md:61`). So the array was **invented**,
     * not misread, which is the failure `REQUIREMENTS.md` §10 exists to prevent: an unsourced
     * shape stated with the same confidence as a measured one.
     *
     * Left as `unknown` until somebody looks (`PROTO-6`). `pnpm probe:ids` reports its type and key count.
     */
    messages: v.optional(v.unknown()),
    /**
     * **A replacement for a credential that has aged** — measured on the real account 2026-09-22
     * (`pnpm probe:token`). Logging in with a token pasted months earlier answers with a different
     * one; logging in with *that* one answers with the same one back. So it is an exchange that
     * happens once, not a rotation on every login.
     *
     * It was undeclared until then, so the exchange happened on every login and the client threw
     * the result away, leaving the profile on whatever was pasted in months ago (`MAX-11`,
     * `NEED-106`). The old token goes on working, which is why this is hygiene rather than repair.
     * `NEED-8` had asserted the rotation in 2026-09-18 on the strength of `tsmax/src/app.ts:99` —
     * somebody else's client — which is a claim; this is the measurement.
     *
     * ⚠ **It is a credential.** Nothing may print it, log it or put it in a fixture. `MaxClient`
     * writes it to the keyring and never returns it.
     */
    token: v.optional(v.string()),
    presence: v.optional(v.unknown()),
    time: v.optional(v.number()),
    chatMarker: v.optional(v.unknown()),
    config: v.optional(v.unknown()),
    videoChatHistory: v.optional(v.unknown()),
  }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-19",
      "measured against MAX 2026-09-20 (`messages` is an object)",
      "measured against MAX 2026-09-22 (`token` replaces a stale credential once, then repeats)",
    ],
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
