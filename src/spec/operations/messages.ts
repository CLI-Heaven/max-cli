import * as v from "valibot"
import { defineOperation, reserveOpcode } from "../define.js"
import { id } from "../scalars.js"

export const messagesSend = defineOperation({
  name: "messages.send",
  constant: "MSG_SEND",
  opcode: 64,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    message: v.strictObject({
      text: v.string(),
      /**
       * The client id MAX deduplicates by — measured, and it is what makes one retry safe. It must
       * never be regenerated on a retry: a fresh one means a second message in somebody's chat.
       */
      cid: v.pipe(v.number(), v.integer()),
      elements: v.array(v.unknown()),
      attaches: v.array(v.unknown()),
    }),
    notify: v.boolean(),
  }),
  response: v.looseObject({ message: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-19, including deduplication by `cid` across two connections"],
    notes: "How long MAX remembers a `cid` is still unmeasured (`PROTO-2`); the two probes were seconds apart.",
  },
})

export const messageDelete = reserveOpcode({
  name: "messages.delete",
  constant: "MSG_DELETE",
  opcode: 66,
  reason:
    "Deliberately never called. Giving this tool the ability to destroy somebody's messages, in order to tidy up after a test, is a poor trade (`NEED-32`).",
  provenance: { confidence: "observed", sources: ["tsmax"] },
})
