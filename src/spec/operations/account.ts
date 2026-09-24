import * as v from "valibot"
import { defineOperation } from "../define.js"

const webClient = "web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24"

export const accountUpdate = defineOperation({
  name: "account.update",
  constant: "PROFILE",
  opcode: 16,
  auth: true,
  request: v.strictObject({
    /** Always sent, filled from the current profile — the web client does, even when only the description changes. */
    firstName: v.pipe(v.string(), v.minLength(1)),
    lastName: v.optional(v.string()),
    description: v.optional(v.string()),
  }),
  response: v.looseObject({ profile: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:account`): the profile rewritten with its own values answered `{profile}` shaped like LOGIN's",
      webClient,
      "PyMax 53103f0 `change_profile`",
      "measured against MAX 2026-09-19: refused an empty payload",
    ],
    notes:
      "Changes the profile everyone sees. It does not read one: your own profile arrives with the login response. `link` (the short name) and `photoToken` exist and are not sent.",
  },
})

export const accountSessions = defineOperation({
  name: "account.sessions",
  constant: "SESSIONS_INFO",
  opcode: 96,
  auth: true,
  request: v.strictObject({}),
  response: v.looseObject({ sessions: v.optional(v.array(v.looseObject({}))) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:account`): `{client, current, info, location, time}` per session — no id",
      webClient,
      "PyMax 53103f0 `get_sessions`",
    ],
  },
})

export const accountCloseSessions = defineOperation({
  name: "account.closeSessions",
  constant: "SESSIONS_CLOSE",
  opcode: 97,
  auth: true,
  request: v.strictObject({}),
  response: v.looseObject({
    /**
     * PyMax replaces its stored token with this; the web client reads nothing from the answer
     * (`RISK-25`). ⚠ A credential: written to the keyring, never printed.
     */
    token: v.optional(v.string()),
  }),
  provenance: {
    confidence: "confirmed",
    sources: [webClient, "PyMax 53103f0 `close_all_sessions`"],
    notes:
      "Ends every session but this one — the owner's phone included. Never measured by us: the first real run is the owner's own (`NEED-202`).",
  },
})
