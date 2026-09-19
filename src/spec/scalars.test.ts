import * as v from "valibot"
import { describe, expect, it } from "vitest"
import { asId, decodeFrame, encodeFrame } from "../protocol/frame.js"
import { id, toWireId, wireId } from "./scalars.js"

const roundTrip = (value: string) => {
  const sent = v.parse(v.object({ chatId: id() }), { chatId: value })
  const raw = encodeFrame({ seq: 1, opcode: 49, payload: sent })
  return { raw, back: asId(decodeFrame(raw).payload?.chatId) }
}

describe("an id on the way out", () => {
  // Both branches, because decodeFrame returns a bigint only for integers a number cannot hold.
  it.each([
    ["0", "number"],
    ["111", "number"],
    ["7268926000000000001", "bigint"],
  ])("survives the wire intact: %s", (value) => {
    const { raw, back } = roundTrip(value)

    expect(raw).toContain(`"chatId":${value}`)
    expect(back).toBe(value)
  })

  it("**is the digit that Number() used to lose**", () => {
    expect(String(Number("7268926000000000001"))).not.toBe("7268926000000000001")
    expect(toWireId("7268926000000000001").toString()).toBe("7268926000000000001")
  })

  it("refuses anything that is not a whole number, rather than sending NaN", () => {
    expect(() => v.parse(id(), "not-an-id")).toThrow(/whole number/)
    expect(() => v.parse(id(), "12.5")).toThrow(/whole number/)
  })
})

describe("an id on the way in", () => {
  it("accepts every form MAX actually sends", () => {
    for (const value of ["7268926000000000001", 111, 7268926000000000001n]) {
      expect(v.parse(wireId(), value)).toBe(value)
    }
  })

  it("rejects what is not an id at all", () => {
    expect(() => v.parse(wireId(), null)).toThrow()
  })
})
