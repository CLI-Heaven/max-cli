import * as v from "valibot"
import { defineOperation, reserveOpcode } from "../define.js"
import { id } from "../scalars.js"

export const chatsList = defineOperation({
  name: "chats.list",
  constant: "CHATS_LIST",
  opcode: 53,
  auth: true,
  request: v.strictObject({
    /** A cursor, not a count: MAX pages from a point in time. */
    marker: v.number(),
    count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  }),
  response: v.looseObject({ chats: v.optional(v.array(v.looseObject({}))) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-19", "max-api-docs/protocol/chats.md"],
    notes: "The documentation describes `count`; tsmax sends only `marker`. Optional here for that reason.",
  },
})

export const chatsHistory = defineOperation({
  name: "chats.history",
  constant: "CHAT_HISTORY",
  opcode: 49,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    from: v.number(),
    forward: v.number(),
    backward: v.number(),
    forwardTime: v.number(),
    backwardTime: v.number(),
    itemType: v.literal("REGULAR"),
    getChat: v.boolean(),
    getMessages: v.boolean(),
    /** False for the same reason as on login: a script reading is not a person looking. */
    interactive: v.literal(false),
  }),
  response: v.looseObject({ messages: v.optional(v.array(v.looseObject({}))) }),
  provenance: { confidence: "measured", sources: ["measured against MAX 2026-09-19"] },
})

export const chatMark = reserveOpcode({
  name: "chats.mark",
  constant: "CHAT_MARK",
  opcode: 50,
  reason:
    "Reading is observational by construction. Marking a conversation read is a change to somebody's account that no read command asked for, so 50 is declared here and never sent — and `src/client.test.ts` asserts its absence from everything the client sent.",
  provenance: { confidence: "confirmed", sources: ["tsmax", "max-api-docs/protocol/chats.md"] },
})
