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
    "**Not a way to read a profile — it updates one**, and refuses an empty payload. Your own profile arrives with the login response, so nothing needs to send this. It is declared here so that fact keeps a home.",
  provenance: { confidence: "measured", sources: ["measured against MAX 2026-09-19: refused an empty payload"] },
})

export const unidentified36 = reserveOpcode({
  name: "protocol.unidentified36",
  constant: "UNIDENTIFIED_36",
  opcode: 36,
  reason:
    "**Nobody agrees what it is.** tsmax and PyMax call it `CONTACT_LIST`; the protocol documentation calls it `GET_BLOCKED`. Sending it to find out would be sending an unknown command to a real account. It stays unsent until somebody watches a real client send it (`PROTO-1`).",
  provenance: {
    confidence: "unknown",
    sources: ["tsmax and PyMax call it CONTACT_LIST", "max-api-docs calls it GET_BLOCKED"],
    notes: "This disagreement is the case the confidence field exists to record.",
  },
})
