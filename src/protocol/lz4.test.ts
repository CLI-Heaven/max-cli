import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { compressBlock, decompressBlock, Lz4Error } from "./lz4.js"

const text = (value: string) => new TextEncoder().encode(value)
const hex = (value: string) => Uint8Array.from(Buffer.from(value, "hex"))

// Compressed by the reference C library (python-lz4 4.x, `lz4.block.compress(store_size=False)`).
const REFERENCE = [
  { raw: text("abcdabcdabcdabcd"), block: hex("43616263640400506461626364") },
  { raw: text("hello world ".repeat(50)), block: hex("cf68656c6c6f20776f726c64200c00ffff36506f726c6420") },
]

describe("LZ4 block", () => {
  it.each(REFERENCE)("reads what the reference library wrote ($raw.length bytes)", ({ raw, block }) => {
    expect(decompressBlock(block, raw.length)).toEqual(raw)
  })

  it.each([
    ["nothing", new Uint8Array(0)],
    ["shorter than a match may start", text("abcdefghijkl")],
    ["repetitive", text("chatId from forward backward ".repeat(40))],
    ["random", Uint8Array.from(randomBytes(2000))],
    ["one long run", new Uint8Array(70_000).fill(7)],
  ])("round-trips %s", (_, raw) => {
    expect(decompressBlock(compressBlock(raw), raw.length)).toEqual(raw)
  })

  it("keeps the last five bytes literal, as the format requires of every block", () => {
    const block = compressBlock(new Uint8Array(100).fill(1))
    expect(Array.from(block.subarray(-5))).toEqual([1, 1, 1, 1, 1])
  })

  it("refuses a block that points before its own start", () => {
    expect(() => decompressBlock(hex("10610500"), 100)).toThrow(Lz4Error)
  })

  it("refuses a block that would grow past what its frame allows", () => {
    expect(() => decompressBlock(compressBlock(new Uint8Array(1000)), 100)).toThrow(/larger than its frame allows/)
  })

  it("refuses a block that ends mid-offset", () => {
    expect(() => decompressBlock(hex("106105"), 100)).toThrow(Lz4Error)
  })
})
