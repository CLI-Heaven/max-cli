import * as v from "valibot"
import { describe, expect, it } from "vitest"
import { checkResponse } from "./check.js"
import { defineOperation } from "./define.js"

const operation = defineOperation({
  name: "chats.history",
  constant: "CHAT_HISTORY",
  opcode: 49,
  auth: true,
  request: v.strictObject({ chatId: v.string() }),
  response: v.looseObject({ messages: v.array(v.looseObject({ time: v.number() })) }),
  provenance: { confidence: "measured", sources: ["a test"] },
})

describe("checkResponse", () => {
  it("says nothing when the answer fits", () => {
    expect(checkResponse(operation, { messages: [{ time: 1 }] })).toBeUndefined()
  })

  it("**treats a field MAX added as normal**, because responses are loose", () => {
    expect(checkResponse(operation, { messages: [{ time: 1, reactions: [] }], somethingNew: true })).toBeUndefined()
  })

  it("names the field when one we rely on changed", () => {
    const note = checkResponse(operation, { messages: [{ time: null }] })

    expect(note).toContain("messages.0.time")
    expect(note).toContain("expected number")
    expect(note).toContain("got null")
  })

  it("**never puts the value it saw into the note**", () => {
    const note = checkResponse(operation, { messages: [{ time: "a private message body" }] })

    expect(note).toBeDefined()
    expect(note).not.toContain("a private message body")
    expect(note).toContain("got string")
  })
})
