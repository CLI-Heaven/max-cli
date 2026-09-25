import { decode, ExtData, ExtensionCodec, encode } from "@msgpack/msgpack"
import { compressBlock, decompressBlock } from "./lz4.js"

/**
 * The binary protocol web.max.ru speaks, captured from a live socket on 2026-09-25
 * (`src/testing/fixtures/web-capture-2026-09-25.json`). JSON on protocol 11 was what we used to
 * send, and nothing the web client sends looks like it.
 */
export const PROTOCOL_VERSION = 10

export const Command = {
  REQUEST: 0,
  RESPONSE: 1,
  EVENT: 2,
  ERROR: 3,
} as const
export type Command = (typeof Command)[keyof typeof Command]

export type Payload = Record<string, unknown>

export interface OutboundFrame {
  seq: number
  opcode: number
  /** Absent, or empty, goes out as a zero-length body — as the web client's ping answer does. */
  payload?: Payload
  cmd?: Command
}

export interface InboundFrame {
  ver: number
  cmd: number
  seq: number
  opcode: number
  payload: Payload | null
}

/** `ver` `cmd` `seq:u16` `opcode:u16` `flags:u8` `length:u24`, big-endian. */
export const HEADER_BYTES = 10

/** The web client sends 31 bytes plain and 37 compressed; where between them it switches was not seen. */
const COMPRESS_FROM = 32
const ZSTD = 0xff
const MAX_LZ4_FLAGS = 0x7f
/** MAX wraps a number it means as a 64-bit id or time in extension type 1; so does the web client. */
const WRAPPED = 1

export const SEQ_MODULO = 0x1_0000

const wrapped = new ExtensionCodec()
wrapped.register({ type: WRAPPED, encode: () => null, decode: (data) => decodeBody(data) })

export const encodeFrame = (frame: OutboundFrame): Uint8Array => {
  const raw = frame.payload && Object.keys(frame.payload).length > 0 ? encodeBody(frame.payload) : new Uint8Array(0)

  let body = raw
  let flags = 0
  if (raw.length >= COMPRESS_FROM) {
    const compressed = compressBlock(raw)
    const factor = Math.ceil(raw.length / compressed.length)
    if (factor <= MAX_LZ4_FLAGS) {
      // Kept even when it came out larger: the web client does the same (47 bytes sent as 49).
      body = compressed
      flags = factor
    }
  }

  const bytes = new Uint8Array(HEADER_BYTES + body.length)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, PROTOCOL_VERSION)
  view.setUint8(1, frame.cmd ?? Command.REQUEST)
  view.setUint16(2, frame.seq % SEQ_MODULO)
  view.setUint16(4, frame.opcode)
  view.setUint32(6, ((flags << 24) | body.length) >>> 0)
  bytes.set(body, HEADER_BYTES)
  return bytes
}

/** The header alone, so a body that cannot be read still says which request it answered. */
export const decodeHeader = (bytes: Uint8Array): Omit<InboundFrame, "payload"> & { flags: number; length: number } => {
  if (bytes.length < HEADER_BYTES) throw new FrameError(`a frame of ${bytes.length} bytes, shorter than its header`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const packed = view.getUint32(6)
  const header = {
    ver: view.getUint8(0),
    cmd: view.getUint8(1),
    seq: view.getUint16(2),
    opcode: view.getUint16(4),
    flags: packed >>> 24,
    length: packed & 0xff_ffff,
  }
  if (HEADER_BYTES + header.length > bytes.length) {
    throw new FrameError(`a frame that claims ${header.length} bytes and carries ${bytes.length - HEADER_BYTES}`)
  }
  return header
}

/**
 * **Integers come back as `number` unless a number would lose digits.** MessagePack hands every
 * 64-bit integer over as a `bigint`, and MAX sends times as 64-bit — a `bigint` timestamp breaks
 * every `Date` and every subtraction above this layer. Message ids are 18 digits, past
 * `Number.MAX_SAFE_INTEGER`, and stay `bigint`; every id leaves the domain mapper as a string.
 */
export const decodeFrame = (bytes: Uint8Array): InboundFrame => {
  const { flags, length, ...header } = decodeHeader(bytes)
  let body = bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)

  if (flags === ZSTD) throw new FrameError("a zstd-compressed frame, which the web client was never seen receiving")
  if (flags > MAX_LZ4_FLAGS) throw new FrameError(`a frame with compression flags ${flags}`)
  if (flags > 0) body = decompressBlock(body, flags * length)

  if (body.length === 0) return { ...header, payload: null }
  const value = decodeBody(body)
  return { ...header, payload: isRecord(value) ? value : null }
}

export class FrameError extends Error {
  constructor(what: string) {
    super(`MAX sent ${what}`)
    this.name = "FrameError"
  }
}

/**
 * Ids arrive as `number` when small and `bigint` when not, and both have to render identically.
 * A domain id is a string from here on — it is an identifier, never arithmetic.
 */
export const asId = (value: unknown): string | undefined => {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && value !== "") return value
  return undefined
}

/** A `bigint` is an id we built from a string (`toWireId`), and goes out wrapped the way the web client wraps ids. */
const encodeBody = (payload: Payload): Uint8Array =>
  encode(wrapBigints(payload), { extensionCodec: wrapped, useBigInt64: true, ignoreUndefined: true })

const decodeBody = (bytes: Uint8Array): unknown =>
  narrow(decode(bytes, { extensionCodec: wrapped, useBigInt64: true, mapKeyConverter: asKey }))

/**
 * ⚠ With `useBigInt64` the library writes every `number` past 32 bits as a **float64**, and MAX
 * refuses a login whose time arrives as one (`proto.payload`, measured 2026-09-25). A whole number
 * that wide goes out as a bare 64-bit integer instead, as the web client sends `from` and
 * `contactsSync`; only a `bigint` — an id — is wrapped.
 */
const wrapBigints = (value: unknown): unknown => {
  if (typeof value === "bigint") return new ExtData(WRAPPED, encode(value, { useBigInt64: true }))
  if (typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) > 0xffff_ffff) return BigInt(value)
  if (Array.isArray(value)) return value.map(wrapBigints)
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wrapBigints(item)]))
  return value
}

const narrow = (value: unknown): unknown => {
  if (typeof value === "bigint")
    return Number.MIN_SAFE_INTEGER <= value && value <= Number.MAX_SAFE_INTEGER ? Number(value) : value
  if (Array.isArray(value)) return value.map(narrow)
  if (isRecord(value)) {
    for (const key of Object.keys(value)) value[key] = narrow(value[key])
  }
  return value
}

/** Map keys are chat and message ids as often as names; ours are always strings. */
const asKey = (key: unknown): string => {
  if (typeof key === "string") return key
  if (typeof key === "number" || typeof key === "bigint") return String(key)
  throw new FrameError(`a map key of type ${typeof key}`)
}

const isRecord = (value: unknown): value is Payload =>
  value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)
