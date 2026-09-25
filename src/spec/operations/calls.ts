import * as v from "valibot"
import { defineOperation } from "../define.js"

/** Sent by `max serve` after each login, as a web tab does (`MAX-52`); the answer is kept only for its sync value. */
const recorded = "web.max.ru tab, recorded 2026-09-25 (`docs_ai/captures/2026-09-25-web-tab-2.jsonl`)"

export const callsHistory = defineOperation({
  name: "calls.history",
  constant: "CALL_HISTORY",
  opcode: 163,
  auth: true,
  request: v.strictObject({ callHistorySync: v.number() }),
  response: v.looseObject({
    callHistoryItems: v.optional(v.array(v.unknown())),
    callHistorySync: v.optional(v.number()),
  }),
  provenance: { confidence: "observed", sources: [recorded] },
})
