import * as v from "valibot"
import { defineOperation } from "../define.js"

/** Sent by `max serve` after each login, as a web tab does (`MAX-52`); the answer is kept only for its sync value. */
const recorded = "web.max.ru tab, recorded 2026-09-25 (`docs_ai/captures/2026-09-25-web-tab-2.jsonl`)"

export const bannersList = defineOperation({
  name: "banners.list",
  constant: "BANNERS_GET",
  opcode: 302,
  auth: true,
  /** Always 0 — the tab sent 0 on its first login and again on the next. */
  request: v.strictObject({ bannersSync: v.number() }),
  response: v.looseObject({ banners: v.optional(v.array(v.unknown())) }),
  provenance: { confidence: "observed", sources: [recorded, "PyMax 53103f0 names it `BANNERS_GET`"] },
})
