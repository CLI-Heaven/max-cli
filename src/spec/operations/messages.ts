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
      /** Left out on a forward, as the web client does: the forwarded message is the content. */
      text: v.optional(v.string()),
      /**
       * The client id MAX deduplicates by — measured, and it is what makes one retry safe. It must
       * never be regenerated on a retry: a fresh one means a second message in somebody's chat.
       */
      cid: v.pipe(v.number(), v.integer()),
      /** Markup in UTF-16 positions. STRONG, EMPHASIZED, STRIKETHROUGH, MONOSPACED read back from MAX 2026-09-24. */
      elements: v.optional(v.array(v.strictObject({ type: v.string(), from: v.number(), length: v.number() }))),
      attaches: v.array(v.unknown()),
      /** Read back as `{type, chatId, message}` — the quoted message whole (measured 2026-09-23). */
      link: v.optional(
        v.variant("type", [
          v.strictObject({ type: v.literal("REPLY"), messageId: id() }),
          /** `chatId` is the chat the message is forwarded **from** (web.max.ru, PyMax). */
          v.strictObject({ type: v.literal("FORWARD"), messageId: id(), chatId: id() }),
        ]),
      ),
    }),
    notify: v.boolean(),
  }),
  response: v.looseObject({ message: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-19, including deduplication by `cid` across two connections",
      "`link` and `elements` measured 2026-09-23 in Saved messages (`pnpm probe:reply`); shapes from tsmax and PyMax",
      "the FORWARD link: web.max.ru `_app/immutable/chunks/5oCuRT0F.js` (2026-09-24), PyMax `api/messages/payloads.py:56-73`",
      "a forward with no `text` and no `elements` measured 2026-09-24 in Saved messages (`pnpm probe:edit-pin-forward`)",
    ],
    notes:
      "How long MAX remembers a `cid` is still unmeasured (`PROTO-2`); the two probes were seconds apart. " +
      "The forward was measured from chat 0 to chat 0, so that `link.chatId` is the source rests on the two clients.",
  },
})

export const messagesEdit = defineOperation({
  name: "messages.edit",
  constant: "MSG_EDIT",
  opcode: 67,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    messageId: id(),
    text: v.string(),
    elements: v.array(v.strictObject({ type: v.string(), from: v.number(), length: v.number() })),
    /** `attachments`, not `attaches` as in MSG_SEND — every source spells them differently. */
    attachments: v.array(v.unknown()),
  }),
  response: v.looseObject({ message: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 in Saved messages (`pnpm probe:edit-pin-forward`)",
      "web.max.ru `_app/immutable/chunks/5oCuRT0F.js` (2026-09-24)",
      "PyMax `api/messages/payloads.py:21-28` (53103f0)",
    ],
    notes:
      'Answers `{message}` with `status: "EDITED"`. `attachments: []` removes a photo; the ones history gives, sent back ' +
      "as they are, keep it. LOGIN's `config.server.edit-timeout` was 604800 s. The web client edits only your own " +
      "messages, and never a forward.",
  },
})

export const messagesReactions = defineOperation({
  name: "messages.reactions",
  constant: "MSG_GET_REACTIONS",
  opcode: 180,
  auth: true,
  request: v.strictObject({ chatId: id(), messageIds: v.array(id()) }),
  response: v.looseObject({ messagesReactions: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 in Saved messages (`pnpm probe:message-shapes`)",
      "tsmax getReactions",
      "PyMax get_reactions",
    ],
    notes:
      "Answers `{messagesReactions: {<message id>: {counters: [{count, reaction}], yourReaction, totalCount}}}`. History carries no reactions (measured 2026-09-23), so this is the only way to read them.",
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

export const messagesUnreact = defineOperation({
  name: "messages.unreact",
  constant: "MSG_CANCEL_REACTION",
  opcode: 179,
  auth: true,
  request: v.strictObject({ chatId: id(), messageId: id() }),
  response: v.looseObject({ reactionInfo: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 in Saved messages", "tsmax removeReaction", "PyMax remove_reaction"],
    notes: "Answers the reactions left, `{reactionInfo: {}}` when none. A second call is answered the same.",
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
