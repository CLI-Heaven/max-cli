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
      /** Markup over the text, in UTF-16 positions. `STRONG` measured 2026-09-23; the rest are tsmax's names. */
      elements: v.array(v.strictObject({ type: v.string(), from: v.number(), length: v.number() })),
      attaches: v.array(v.unknown()),
      /** Read back as `{type, chatId, message}` — the quoted message whole (measured 2026-09-23). */
      link: v.optional(v.strictObject({ type: v.literal("REPLY"), messageId: id() })),
    }),
    notify: v.boolean(),
  }),
  response: v.looseObject({ message: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-19, including deduplication by `cid` across two connections",
      "`link` and `elements` measured 2026-09-23 in Saved messages (`pnpm probe:reply`); shapes from tsmax and PyMax",
    ],
    notes: "How long MAX remembers a `cid` is still unmeasured (`PROTO-2`); the two probes were seconds apart.",
  },
})

export const messagesReact = defineOperation({
  name: "messages.react",
  constant: "MSG_REACTION",
  opcode: 178,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    messageId: id(),
    reaction: v.strictObject({ reactionType: v.literal("EMOJI"), id: v.string() }),
  }),
  response: v.looseObject({ reactionInfo: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-23 in Saved messages (`pnpm probe:reply`)",
      "tsmax addReaction",
      "PyMax add_reaction",
    ],
    notes:
      "Answers `{reactionInfo: {counters: [{count, reaction}], yourReaction, totalCount}}`. Allowed by the owner (`NEED-141`).",
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
