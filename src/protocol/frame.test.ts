import { describe, expect, it } from "vitest"
import { asId, Command, decodeFrame, encodeFrame, FrameError, PROTOCOL_VERSION } from "./frame.js"

describe("encodeFrame", () => {
  it("pins the protocol version the web client uses", () => {
    const encoded = JSON.parse(encodeFrame({ seq: 1, opcode: 19, payload: {} }))
    expect(encoded.ver).toBe(PROTOCOL_VERSION)
    expect(encoded.ver).toBe(11)
  })

  it("defaults to a request, because that is all we ever originate", () => {
    expect(JSON.parse(encodeFrame({ seq: 7, opcode: 53, payload: { marker: 0 } })).cmd).toBe(Command.REQUEST)
  })

  it("carries seq, opcode and payload through unchanged", () => {
    const encoded = JSON.parse(encodeFrame({ seq: 42, opcode: 64, payload: { chatId: 1, text: "hi" } }))
    expect(encoded).toEqual({ ver: 11, cmd: 0, seq: 42, opcode: 64, payload: { chatId: 1, text: "hi" } })
  })
})

describe("decodeFrame", () => {
  it("reads a response", () => {
    const frame = decodeFrame('{"ver":11,"cmd":1,"seq":3,"opcode":16,"payload":{"profile":{}}}')
    expect(frame).toEqual({ ver: 11, cmd: 1, seq: 3, opcode: 16, payload: { profile: {} } })
  })

  it("keeps a 64-bit id exact, which JSON.parse cannot", () => {
    const raw = '{"ver":11,"cmd":1,"seq":1,"opcode":49,"payload":{"id":7268926000000000001}}'
    const id = (decodeFrame(raw).payload as { id: unknown }).id

    expect(typeof id).toBe("bigint")
    expect(asId(id)).toBe("7268926000000000001")
    // What the built-in parser would have done, and why this matters.
    expect(String(JSON.parse(raw).payload.id)).not.toBe("7268926000000000001")
  })

  it("distinguishes two chat ids that JSON.parse would collapse into one", () => {
    const first = decodeFrame('{"ver":11,"cmd":1,"seq":1,"opcode":53,"payload":{"id":7268926000000000001}}')
    const second = decodeFrame('{"ver":11,"cmd":1,"seq":1,"opcode":53,"payload":{"id":7268926000000000002}}')
    expect(asId((first.payload as { id: unknown }).id)).not.toBe(asId((second.payload as { id: unknown }).id))
  })

  it("treats an event with no seq as an event, not as a broken frame", () => {
    expect(decodeFrame('{"ver":11,"cmd":0,"opcode":128,"payload":{}}').seq).toBeNull()
  })

  it("survives a payload that is not an object", () => {
    expect(decodeFrame('{"ver":11,"cmd":3,"seq":2,"opcode":19,"payload":null}').payload).toBeNull()
  })

  it("refuses a frame that is not an object at all", () => {
    expect(() => decodeFrame("[]")).toThrow(FrameError)
    expect(() => decodeFrame('"hello"')).toThrow(FrameError)
  })

  it("refuses a header field that is not a whole number", () => {
    expect(() => decodeFrame('{"ver":11,"cmd":1,"seq":"x","opcode":16,"payload":{}}')).toThrow(FrameError)
  })

  it("names MAX in the error, so the reader knows whose fault it is", () => {
    expect(() => decodeFrame("[]")).toThrow(/MAX sent/)
  })
})

describe("asId", () => {
  it("turns every id the wire can carry into the same string form", () => {
    expect(asId(7268926)).toBe("7268926")
    expect(asId(7268926000000000001n)).toBe("7268926000000000001")
    expect(asId("7268926")).toBe("7268926")
  })

  it("says nothing rather than inventing an id", () => {
    expect(asId(undefined)).toBeUndefined()
    expect(asId(null)).toBeUndefined()
    expect(asId("")).toBeUndefined()
    expect(asId(Number.NaN)).toBeUndefined()
  })
})
