import { describe, expect, it } from "vitest"
import { countsIn, idsOf, renderEvent } from "./events.js"

describe("what an event may carry", () => {
  it("**takes the ids a request named and nothing else from it**", () => {
    expect(idsOf({ chatId: "0", from: 1789776000000, backward: 20, itemType: "REGULAR" })).toEqual({
      ids: { chat: "0" },
    })
  })

  it("**cannot reach a token, because no branch here looks for one**", () => {
    const login = { token: "a-real-looking-token", interactive: false, chatsCount: 40, chatsSync: 0 }
    expect(JSON.stringify(idsOf(login))).not.toContain("a-real-looking-token")
    expect(idsOf(login)).toEqual({})
  })

  it("leaves the message behind and keeps the `cid` that makes a send repeatable", () => {
    const send = { chatId: "0", message: { text: "something private", cid: 4242, elements: [] }, notify: true }
    const picked = idsOf(send)

    expect(picked).toEqual({ ids: { chat: "0", cid: "4242" } })
    expect(JSON.stringify(picked)).not.toContain("something private")
  })

  it("counts the people a lookup asked about rather than naming them", () => {
    expect(idsOf({ contactIds: ["10000003", "10000004"] })).toEqual({ counts: { contacts: 2 } })
  })

  it("counts every list in an answer, and takes nothing out of one", () => {
    const answer = {
      chats: [{ title: "Family" }, { title: "Work" }],
      contacts: [{ name: "Ivan Petrov" }],
      profile: { name: "Ivan Petrov" },
    }

    const counts = countsIn(answer)
    expect(counts).toEqual({ chats: 2, contacts: 1 })
    expect(JSON.stringify(counts)).not.toContain("Ivan")
  })

  it("says nothing about an answer that has no lists", () => {
    expect(countsIn({ profile: {} })).toBeUndefined()
  })
})

describe("the line a person reads", () => {
  it("shows the direction, the operation, the ids and the cost", () => {
    expect(
      renderEvent({ event: "request", operation: "chats.history", opcode: 49, seq: 3, bytes: 180, ids: { chat: "0" } }),
    ).toBe("→ chats.history    op 49  seq 3  chat 0  180 B")

    expect(
      renderEvent({
        event: "response",
        operation: "chats.history",
        opcode: 49,
        seq: 3,
        bytes: 4200,
        durationMs: 118,
        counts: { messages: 3 },
        outcome: "ok",
      }),
    ).toBe("← chats.history    op 49  seq 3  118ms  4.2 kB  3 messages")
  })

  it("names the code when nothing came back", () => {
    const line = renderEvent({
      event: "response",
      operation: "messages.send",
      opcode: 64,
      seq: 4,
      durationMs: 20000,
      outcome: "error",
      errorCode: "timeout",
    })

    expect(line).toContain("timeout")
    expect(line).not.toContain("kB")
  })

  it("has a shape for a read that never left the machine, and says why it did not", () => {
    const line = renderEvent({
      event: "cache",
      operation: "chats.list",
      reason: "offline",
      ageMs: 42_000,
      counts: { chats: 25 },
    })

    expect(line).toBe("• chats.list       offline  cached 42s  25 chats")
    expect(line).not.toContain("seq")

    // "We did not ask" and "there was nothing to ask" read differently in a log, and only the
    // second is the record answering a question a connection could not have answered better.
    expect(renderEvent({ event: "cache", operation: "messages.list", reason: "history" })).toContain("history")
  })
})
