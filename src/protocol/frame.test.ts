import { readFileSync } from "node:fs"
import { encode } from "@msgpack/msgpack"
import { describe, expect, it } from "vitest"
import { asId, Command, decodeFrame, encodeFrame, FrameError, HEADER_BYTES, PROTOCOL_VERSION } from "./frame.js"
import { compressBlock, decompressBlock } from "./lz4.js"

interface CapturedFrame {
  dir: "in" | "out"
  header: string
  seq: number
  opcode: number
  flags: number
  length: number
  rawLength?: number
}

const capture = JSON.parse(
  readFileSync(new URL("../testing/fixtures/web-capture-2026-09-25.json", import.meta.url), "utf8"),
) as { socket: { url: string }[]; frames: CapturedFrame[] }

const headerOf = (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, HEADER_BYTES)).toString("hex").match(/../g)?.join(" ")

/** A frame as MAX would send it: hand-built bytes, so the decoder is not only checked against our own encoder. */
const serverFrame = (seq: number, opcode: number, body: Uint8Array, cmd: number = Command.RESPONSE, flags = 0) => {
  const bytes = new Uint8Array(HEADER_BYTES + body.length)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, 10)
  view.setUint8(1, cmd)
  view.setUint16(2, seq)
  view.setUint16(4, opcode)
  view.setUint32(6, ((flags << 24) | body.length) >>> 0)
  bytes.set(body, HEADER_BYTES)
  return bytes
}

/** `c7 09 01` + a uint64 — MAX's extension 1 around a 64-bit integer. */
const wrapped64 = (value: bigint) => {
  const inner = encode(value, { useBigInt64: true })
  return Uint8Array.from([0xc7, inner.length, 1, ...inner])
}

describe("encodeFrame", () => {
  it("writes the header byte for byte as web.max.ru does", () => {
    // The web client's first chat request after LOGIN: seq 2, opcode 48, 22 bytes, not compressed.
    const recorded = capture.frames.find((frame) => frame.dir === "out" && frame.seq === 2 && frame.opcode === 48)
    const bytes = encodeFrame({ seq: 2, opcode: 48, payload: { chatIds: [7268926000000000001n] } })

    expect(recorded?.header).toBe("0a 00 00 02 00 30 00 00 00 16")
    expect(headerOf(bytes)).toBe("0a 00 00 02 00 30 00 00 00 16")
  })

  it("pins protocol 10 and defaults to a request", () => {
    const bytes = encodeFrame({ seq: 7, opcode: 53, payload: { marker: 0 } })
    expect(bytes[0]).toBe(PROTOCOL_VERSION)
    expect(PROTOCOL_VERSION).toBe(10)
    expect(bytes[1]).toBe(Command.REQUEST)
  })

  it("sends no payload as no bytes at all, as the web client's empty frames are", () => {
    expect(headerOf(encodeFrame({ seq: 24, opcode: 1, cmd: Command.RESPONSE }))).toBe("0a 01 00 18 00 01 00 00 00 00")
    expect(encodeFrame({ seq: 1, opcode: 288, payload: {} })).toHaveLength(HEADER_BYTES)
  })

  it("drops a field whose value is undefined instead of sending nil", () => {
    const frame = decodeFrame(encodeFrame({ seq: 1, opcode: 64, payload: { text: "hi", replyTo: undefined } }))
    expect(frame.payload).toEqual({ text: "hi" })
  })

  it("sends a 13-digit time as a 64-bit integer, never as a float, and does not wrap it", () => {
    const bytes = encodeFrame({ seq: 1, opcode: 19, payload: { contactsSync: 1_790_328_205_681 } })
    const body = Buffer.from(bytes.subarray(HEADER_BYTES)).toString("hex")

    expect(body).toContain("cf000001a0")
    expect(body).not.toContain("cb")
    expect(decodeFrame(bytes).payload).toEqual({ contactsSync: 1_790_328_205_681 })
  })

  it.each([-70_000_000_000_001, -3_000_000_000, 5_000_000_000])("never writes %d as a float", (value) => {
    const body = Buffer.from(encodeFrame({ seq: 1, opcode: 49, payload: { n: value } }).subarray(HEADER_BYTES))
    expect(body[3]).not.toBe(0xcb)
    expect(decodeFrame(encodeFrame({ seq: 1, opcode: 49, payload: { n: value } })).payload).toEqual({ n: value })
  })

  it("sends bytes as MessagePack bin — the field a voice message's wave needs", () => {
    const wave = Uint8Array.from({ length: 80 }, (_, index) => index)
    const bytes = encodeFrame({ seq: 1, opcode: 64, payload: { wave } })
    const length = bytes.length - HEADER_BYTES
    const raw = decompressBlock(bytes.subarray(HEADER_BYTES), (bytes[6] as number) * length)

    expect(decodeFrame(bytes).payload).toEqual({ wave })
    expect(Buffer.from(raw).toString("hex")).toContain("a477617665c450")
  })

  it("wraps the two-byte seq", () => {
    expect(headerOf(encodeFrame({ seq: 65_537, opcode: 1 }))?.slice(0, 11)).toBe("0a 00 00 01")
  })

  it("compresses from 32 bytes on, the way every recorded frame was — in both directions", () => {
    const measured = capture.frames.filter((frame) => frame.rawLength !== undefined && frame.rawLength > 0)
    expect(measured.length).toBeGreaterThan(60)

    for (const frame of measured) {
      const raw = frame.rawLength as number
      expect({ raw, compressed: frame.flags > 0 }).toEqual({ raw, compressed: raw >= 32 })
      if (frame.flags > 0) expect({ raw, flags: frame.flags }).toEqual({ raw, flags: Math.ceil(raw / frame.length) })
    }
  })

  it("reads back what it compressed", () => {
    const payload = {
      chatId: 7268926000000000001n,
      from: 1_758_700_000_000,
      forward: 0,
      backward: 30,
      getMessages: true,
    }
    const bytes = encodeFrame({ seq: 30, opcode: 49, payload })

    expect(bytes[6]).toBeGreaterThan(0)
    expect(decodeFrame(bytes).payload).toEqual({ ...payload, chatId: 7268926000000000001n })
  })
})

describe("decodeFrame", () => {
  it("keeps an 18-digit id exact and turns a 13-digit time into a number", () => {
    const body = Uint8Array.from([
      0x82,
      0xa2,
      0x69,
      0x64,
      ...wrapped64(7268926000000000001n),
      0xa4,
      0x74,
      0x69,
      0x6d,
      0x65,
      ...wrapped64(1_758_700_000_000n),
    ])
    const payload = decodeFrame(serverFrame(3, 49, body)).payload as { id: unknown; time: unknown }

    expect(payload.id).toBe(7268926000000000001n)
    expect(asId(payload.id)).toBe("7268926000000000001")
    expect(payload.time).toBe(1_758_700_000_000)
  })

  it("turns a small id wrapped in extension 1 into a plain number", () => {
    const body = Uint8Array.from([0x81, 0xa2, 0x69, 0x64, 0xd4, 0x01, 0x07])
    expect(decodeFrame(serverFrame(1, 48, body)).payload).toEqual({ id: 7 })
  })

  it("keys a map by id as a string, however the id was written", () => {
    const body = Uint8Array.from([0x82, ...wrapped64(7268926000000000001n), 0xa1, 0x61, 0x05, 0xa1, 0x62])
    expect(decodeFrame(serverFrame(1, 180, body)).payload).toEqual({ "7268926000000000001": "a", "5": "b" })
  })

  it("decompresses an LZ4 body before reading it", () => {
    const raw = encode({ text: "hello world ".repeat(50) })
    const body = compressBlock(raw)
    const flags = Math.ceil(raw.length / body.length)

    expect(decodeFrame(serverFrame(1, 64, body, Command.RESPONSE, flags)).payload).toEqual({
      text: "hello world ".repeat(50),
    })
  })

  it("reads a frame with no body as no payload", () => {
    expect(decodeFrame(serverFrame(24, 1, new Uint8Array(0)))).toEqual({
      ver: 10,
      cmd: 1,
      seq: 24,
      opcode: 1,
      payload: null,
    })
  })

  it("refuses a zstd body by name rather than returning garbage", () => {
    expect(() => decodeFrame(serverFrame(1, 19, Uint8Array.from([1, 2, 3]), Command.RESPONSE, 0xff))).toThrow(/zstd/)
  })

  it("refuses a frame shorter than its header, or than the length it claims", () => {
    expect(() => decodeFrame(new Uint8Array(4))).toThrow(FrameError)
    const truncated = serverFrame(1, 19, Uint8Array.from([0x80])).subarray(0, HEADER_BYTES)
    expect(() => decodeFrame(truncated)).toThrow(/claims 1 bytes/)
  })

  it("names MAX in the error, so the reader knows whose fault it is", () => {
    expect(() => decodeFrame(new Uint8Array(2))).toThrow(/MAX sent/)
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
