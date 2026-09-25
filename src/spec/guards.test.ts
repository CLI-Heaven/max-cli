import { describe, expect, it } from "vitest"
import { OPERATIONS } from "../generated/operations.generated.js"

const guardOf = (name: keyof typeof OPERATIONS) => {
  const guard = OPERATIONS[name].guard
  if (!guard) throw new Error(`${name} declares no guard`)
  return guard
}

describe("the guard each write declares", () => {
  it("reads a send, a forward and a new group apart, though all three are one opcode", () => {
    const send = guardOf("messages.send")

    expect(send({ chatId: 1n, message: { cid: 5, text: "hi", attaches: [] } })).toMatchObject({
      chatId: "1",
      kind: "message",
      cid: 5,
      length: 2,
    })
    expect(
      send({ chatId: 2n, message: { cid: 6, attaches: [], link: { type: "FORWARD", chatId: 1n, messageId: 9n } } }),
    ).toMatchObject({ chatId: "2", kind: "forward" })
    expect(
      send({ message: { cid: 7, attaches: [{ _type: "CONTROL", event: "new", userIds: [3n, 4n] }] } }),
    ).toMatchObject({ chatId: null, kind: "chat", action: "create", people: 2 })
  })

  it("refuses a send with no chat that is not a new group, rather than skip the recipient list", () => {
    expect(() => guardOf("messages.send")({ message: { cid: 1, text: "hi", attaches: [] } })).toThrow(/chatId/)
  })

  it("refuses a chat update that is a pin and a rename at once", () => {
    const update = guardOf("chats.update")

    expect(update({ chatId: 1n, pinMessageId: 9n, notifyPin: false })).toMatchObject({ kind: "pin", messageId: "9" })
    expect(() => update({ chatId: 1n, pinMessageId: 9n, theme: "x" })).toThrow(/one change/)
  })

  it("counts a deletion per message", () => {
    expect(guardOf("messages.delete")({ chatId: 1n, messageIds: [1n, 2n, 3n], forMe: false })).toMatchObject({
      kind: "delete",
      count: 3,
      forEveryone: true,
    })
  })

  it("names the member change from its operation and type", () => {
    expect(
      guardOf("chats.updateMembers")({ chatId: 1n, userIds: [2n], operation: "remove", type: "ADMIN" }),
    ).toMatchObject({ action: "admins.remove", people: 1 })
  })
})
