/**
 * LZ4 *block* format — no frame header, no checksum — which is what MAX puts in a frame body.
 *
 * Hand-written because both directions are small and a native binding is what breaks under Bun
 * (REQUIREMENTS §36). The decompressor mirrors the one that read all 73 frames of the 2026-09-25
 * capture; the compressor keeps the format's end-of-block rules, which a lenient decoder such as
 * ours would not notice being broken but MAX's might.
 */

const MIN_MATCH = 4
/** The last five bytes of a block are always literals. */
const LAST_LITERALS = 5
/** No match may start within the last twelve bytes. */
const MF_LIMIT = 12
const MAX_OFFSET = 0xffff
const HASH_BITS = 12

export class Lz4Error extends Error {
  constructor(what: string) {
    super(`MAX sent an LZ4 block that ${what}`)
    this.name = "Lz4Error"
  }
}

export const compressBlock = (src: Uint8Array): Uint8Array => {
  const out = new Growable(src.length + (src.length >> 8) + 16)
  const table = new Int32Array(1 << HASH_BITS).fill(-1)
  const matchLimit = src.length - LAST_LITERALS
  let anchor = 0
  let i = 0

  while (i < src.length - MF_LIMIT) {
    const sequence = read32(src, i)
    const slot = Math.imul(sequence, 2654435761) >>> (32 - HASH_BITS)
    const candidate = table[slot] as number
    table[slot] = i

    if (candidate < 0 || i - candidate > MAX_OFFSET || read32(src, candidate) !== sequence) {
      i += 1
      continue
    }

    let length = MIN_MATCH
    while (i + length < matchLimit && src[i + length] === src[candidate + length]) length += 1

    writeSequence(out, src.subarray(anchor, i), i - candidate, length)
    i += length
    anchor = i
  }

  writeSequence(out, src.subarray(anchor), 0, 0)
  return out.bytes()
}

/** `maxOutput` bounds a hostile or corrupt block; the frame header gives the caller one. */
export const decompressBlock = (src: Uint8Array, maxOutput: number): Uint8Array => {
  const out = new Growable(Math.min(maxOutput, src.length * 4))
  let p = 0

  while (p < src.length) {
    const token = src[p++] as number

    let literals = token >> 4
    if (literals === 15) literals += readLength(src, () => p++)
    if (p + literals > src.length) throw new Lz4Error("runs past its own end")
    out.append(src.subarray(p, p + literals))
    p += literals
    if (out.length > maxOutput) throw new Lz4Error("is larger than its frame allows")

    if (p >= src.length) break

    if (p + 2 > src.length) throw new Lz4Error("ends in the middle of an offset")
    const offset = (src[p] as number) | ((src[p + 1] as number) << 8)
    p += 2
    if (offset === 0 || offset > out.length) throw new Lz4Error("points before its own start")

    let length = token & 15
    if (length === 15) length += readLength(src, () => p++)
    length += MIN_MATCH
    if (out.length + length > maxOutput) throw new Lz4Error("is larger than its frame allows")
    out.copyBack(offset, length)
  }

  return out.bytes()
}

const read32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] as number) |
    ((bytes[at + 1] as number) << 8) |
    ((bytes[at + 2] as number) << 16) |
    ((bytes[at + 3] as number) << 24)) >>>
  0

const readLength = (src: Uint8Array, next: () => number): number => {
  let total = 0
  let byte: number
  do {
    const at = next()
    if (at >= src.length) throw new Lz4Error("ends in the middle of a length")
    byte = src[at] as number
    total += byte
  } while (byte === 255)
  return total
}

const writeLength = (out: Growable, value: number): void => {
  let rest = value
  while (rest >= 255) {
    out.push(255)
    rest -= 255
  }
  out.push(rest)
}

/** A match length of zero means the final, literals-only sequence. */
const writeSequence = (out: Growable, literals: Uint8Array, offset: number, matchLength: number): void => {
  const literalNibble = Math.min(literals.length, 15)
  const matchNibble = matchLength === 0 ? 0 : Math.min(matchLength - MIN_MATCH, 15)
  out.push((literalNibble << 4) | matchNibble)
  if (literals.length >= 15) writeLength(out, literals.length - 15)
  out.append(literals)
  if (matchLength === 0) return

  out.push(offset & 0xff)
  out.push(offset >> 8)
  if (matchLength - MIN_MATCH >= 15) writeLength(out, matchLength - MIN_MATCH - 15)
}

class Growable {
  #buffer: Uint8Array
  length = 0

  constructor(capacity: number) {
    this.#buffer = new Uint8Array(Math.max(capacity, 16))
  }

  push(byte: number): void {
    this.#reserve(1)
    this.#buffer[this.length++] = byte
  }

  append(bytes: Uint8Array): void {
    this.#reserve(bytes.length)
    this.#buffer.set(bytes, this.length)
    this.length += bytes.length
  }

  /** Byte by byte on purpose: a match may overlap the bytes it is still producing. */
  copyBack(offset: number, length: number): void {
    this.#reserve(length)
    const from = this.length - offset
    for (let k = 0; k < length; k++) this.#buffer[this.length + k] = this.#buffer[from + k] as number
    this.length += length
  }

  bytes(): Uint8Array {
    return this.#buffer.slice(0, this.length)
  }

  #reserve(extra: number): void {
    if (this.length + extra <= this.#buffer.length) return
    const next = new Uint8Array(Math.max(this.#buffer.length * 2, this.length + extra))
    next.set(this.#buffer.subarray(0, this.length))
    this.#buffer = next
  }
}
