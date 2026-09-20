import * as v from "valibot"
import { defineOperation, reserveOpcode } from "../define.js"
import { id } from "../scalars.js"

export const contactsInfo = defineOperation({
  name: "contacts.info",
  constant: "CONTACT_INFO",
  opcode: 32,
  auth: true,
  request: v.strictObject({ contactIds: v.array(id()) }),
  response: v.looseObject({ contacts: v.optional(v.array(v.looseObject({}))) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-19: asked for ten, got ten"],
    notes: "One request for every unknown id at once. A person with forty dialogs should not cost forty round trips.",
  },
})

export const profile = reserveOpcode({
  name: "account.update",
  constant: "PROFILE",
  opcode: 16,
  reason:
    "It does not read a profile, it updates one, and it refuses an empty payload. Your own profile arrives with the login response, so nothing needs to send this. It is declared here so that fact keeps a home.",
  provenance: { confidence: "measured", sources: ["measured against MAX 2026-09-19: refused an empty payload"] },
})

export const unidentified36 = reserveOpcode({
  name: "protocol.unidentified36",
  constant: "UNIDENTIFIED_36",
  opcode: 36,
  reason:
    "Nobody agrees what it is: tsmax and PyMax call it `CONTACT_LIST`; the protocol documentation calls it `GET_BLOCKED`. Sent once with the owner's permission on 2026-09-20 and it exists — but it refuses every payload we can guess, and one guess closed the connection. It stays unsent until somebody watches a real client send it (`PROTO-1`).",
  provenance: {
    confidence: "unknown",
    sources: [
      "tsmax and PyMax call it CONTACT_LIST",
      "max-api-docs calls it GET_BLOCKED",
      "measured against MAX 2026-09-20: `{}` and `{marker}` are refused with `proto.payload`, `{marker, count}` closes the connection",
    ],
    notes:
      "The refusal names the payload rather than the opcode, so 36 is real and validates its arguments — we simply do not know its shape. Guessing cost a dropped connection, which is why the ladder stopped at three.",
  },
})
