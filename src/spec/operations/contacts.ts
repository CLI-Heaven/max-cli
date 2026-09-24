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

const webClient = "web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24"

export const contactsByPhone = defineOperation({
  name: "contacts.byPhone",
  constant: "CONTACT_INFO_BY_PHONE",
  opcode: 46,
  auth: true,
  request: v.strictObject({ phone: v.pipe(v.string(), v.minLength(1)) }),
  response: v.looseObject({ contact: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:account`): the owner's own number answered with the owner",
      webClient,
      "PyMax 53103f0 `search_by_phone`",
    ],
    notes: "⚠ The request carries a phone number: nothing may log it, print it in an error or keep it in a fixture.",
  },
})

export const contactsUpdate = defineOperation({
  name: "contacts.update",
  constant: "CONTACT_UPDATE",
  opcode: 34,
  auth: true,
  request: v.strictObject({ contactId: id(), action: v.picklist(["ADD", "REMOVE"]) }),
  response: v.looseObject({ contact: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "confirmed",
    sources: [webClient, "PyMax 53103f0 `add_contact`, `remove_contact`"],
    notes:
      "The web client also sends `UPDATE` (a name of your own for the person), `BLOCK` and `UNBLOCK` here. Only adding and removing are declared.",
  },
})

export const contactsImport = defineOperation({
  name: "contacts.import",
  constant: "SYNC",
  opcode: 21,
  auth: true,
  request: v.strictObject({
    /** Phone number to the name it was saved under. */
    contactList: v.record(v.string(), v.strictObject({ firstName: v.string() })),
  }),
  response: v.looseObject({ contacts: v.optional(v.array(v.looseObject({}))) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:account`), the owner's own number only: answered `{phones: {<number>: <number>}}` and no contact",
      "PyMax 53103f0 `import_contacts`",
    ],
    notes:
      "One witness, under a generic name: not found in the entry chunks of web.max.ru (2026-09-24), whose lazy chunks were not read. It uploads other people's numbers to MAX (`NEED-203`).",
  },
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
