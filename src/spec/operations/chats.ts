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

/** `join/<token>` — what 57 and 89 take for a private link. A public channel's link goes whole. */
const link = () => v.pipe(v.string(), v.minLength(1))

export const chatsLinkInfo = defineOperation({
  name: "chats.linkInfo",
  constant: "LINK_INFO",
  opcode: 89,
  auth: true,
  request: v.strictObject({ link: link() }),
  response: v.looseObject({ chat: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 (`pnpm probe:groups`)", "PyMax resolve_group_by_link"],
    notes: "Joins nothing. Answers for a group the account has left, with `participants` empty.",
  },
})

export const chatsJoin = defineOperation({
  name: "chats.join",
  constant: "CHAT_JOIN",
  opcode: 57,
  auth: true,
  request: v.strictObject({ link: link() }),
  response: v.looseObject({ chat: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 with a private group link (`pnpm probe:groups`)", "PyMax join_group"],
    notes:
      "A public channel's link (`https://max.ru/<name>`) goes whole, as PyMax join_channel sends it — not measured.",
  },
})

export const chatsLeave = defineOperation({
  name: "chats.leave",
  constant: "CHAT_LEAVE",
  opcode: 58,
  auth: true,
  request: v.strictObject({ chatId: id() }),
  response: v.looseObject({ message: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 (`pnpm probe:groups`)", "PyMax leave_group"],
    notes: "Answers the service message about leaving, which the others in the chat see.",
  },
})

export const chatsUpdate = defineOperation({
  name: "chats.update",
  constant: "CHAT_UPDATE",
  opcode: 55,
  auth: true,
  request: v.union([
    /** MAX calls the name `theme`. */
    v.strictObject({ chatId: id(), theme: v.optional(v.string()), description: v.optional(v.string()) }),
    /** Only the flags that change. */
    v.strictObject({ chatId: id(), options: v.record(v.string(), v.boolean()) }),
    v.strictObject({ chatId: id(), revokePrivateLink: v.literal(true) }),
    /** `"0"` unpins — the web client sends `message?.id ?? 0n`. */
    v.strictObject({ chatId: id(), pinMessageId: id(), notifyPin: v.boolean() }),
  ]),
  response: v.looseObject({ chat: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:groups`, `pnpm probe:members`)",
      "PyMax change_group_profile, change_group_settings, rework_invite_link",
      "the pin: measured 2026-09-24 in a group the owner named (`pnpm probe:edit-pin-forward`, `PIN_CHAT`); web.max.ru `_app/immutable/chunks/5oCuRT0F.js`; PyMax `api/messages/payloads.py:95-98` (53103f0)",
    ],
    notes:
      "A setting changed from false to true, measured 2026-09-24 (`pnpm probe:members`). max-api-docs calls 55 a no-op; it sent `{chatId}` alone. " +
      "Pinning: the web client does not notify by default and PyMax does; ours follows the web client (`NEED-196`). " +
      "Refused on 2026-09-24 in Saved messages and in a dialog with a person — `not.found` to pin, " +
      "`chat.not.found` to unpin. The web client's dialog class answers `viewerCanPin` with `false`: MAX pins " +
      "only in groups and channels. In a group it answers `{chat}` with `pinnedMessage`, and 0 clears it.",
  },
})

export const chatsMembers = defineOperation({
  name: "chats.members",
  constant: "CHAT_MEMBERS",
  opcode: 59,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    type: v.literal("JOIN_REQUEST"),
    count: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  response: v.looseObject({ members: v.optional(v.array(v.looseObject({}))) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 with no requests (`pnpm probe:groups`)", "PyMax get_join_requests"],
    notes: "With no requests the answer is `{}` — no `members` at all. Each member is `{contact, presence}` in PyMax.",
  },
})

export const chatsUpdateMembers = defineOperation({
  name: "chats.updateMembers",
  constant: "CHAT_MEMBERS_UPDATE",
  opcode: 77,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    userIds: v.pipe(v.array(id()), v.minLength(1)),
    operation: v.picklist(["add", "remove"]),
    /** Absent means an ordinary member. */
    type: v.optional(v.picklist(["ADMIN", "JOIN_REQUEST"])),
    showHistory: v.optional(v.boolean()),
    /** Always 0 from us: anything else probably erases the removed person's messages (`NEED-32`). */
    cleanMsgPeriod: v.optional(v.literal(0)),
    /** A sum of admin rights: members 2, admins 4, info 8, pin 16, post 256, edit 512, delete 1024. */
    permissions: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
  response: v.looseObject({ chat: v.optional(v.looseObject({})) }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 with a second person who agreed (`pnpm probe:members`): add, make admin, take admin back, remove",
      "PyMax invite_users_to_group, remove_users_from_group, add_admin, confirm_join_request, decline_join_request",
    ],
    notes:
      "Taking admin rights back is `type: ADMIN, operation: remove` — in no source, measured. The JOIN_REQUEST forms are PyMax's only: they need somebody asking to join (`MAX-41`). max-api-docs calls 77 pin/archive/mute; measured otherwise.",
  },
})

export const chatDelete = reserveOpcode({
  name: "chats.delete",
  constant: "CHAT_DELETE",
  opcode: 52,
  reason:
    "Deleting a chat is left out of MAX-31 for the reason of `NEED-32`: a tool that can destroy a conversation for everyone in it is a poor trade for tidiness.",
  provenance: { confidence: "observed", sources: ["PyMax delete_chat", "tsmax"] },
})
