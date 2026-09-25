import * as v from "valibot"
import { defineOperation } from "../define.js"

/** Sent by `max serve` after each login, as a web tab does (`MAX-52`); the answer is kept only for its sync value. */
const recorded = "web.max.ru tab, recorded 2026-09-25 (`docs_ai/captures/2026-09-25-web-tab-2.jsonl`)"

export const ASSET_TYPES = ["STICKER", "FAVORITE_STICKER", "REACTION", "ANIMOJI_SET"] as const

export const assetsUpdate = defineOperation({
  name: "assets.update",
  constant: "ASSETS_UPDATE",
  opcode: 27,
  auth: true,
  request: v.strictObject({ type: v.picklist(ASSET_TYPES), sync: v.number() }),
  response: v.looseObject({ sync: v.optional(v.number()), sections: v.optional(v.array(v.unknown())) }),
  provenance: {
    confidence: "observed",
    sources: [recorded, "PyMax 53103f0 names it `ASSETS_UPDATE` and never sends it"],
    notes: "The tab sends the four types in this order, each with the `sync` its previous answer carried.",
  },
})
