import { isInteger, isSafeNumber, parse, stringify } from "lossless-json"

/** The protocol version the web client pins. Confirmed in tsmax, maxrs and max-api-docs. */
export const PROTOCOL_VERSION = 11

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
  payload: Payload
  cmd?: Command
}

export interface InboundFrame {
  ver: number
  cmd: number
  seq: number | null
  opcode: number
  payload: Payload | null
}

export const encodeFrame = (frame: OutboundFrame): string =>
  stringify({
    ver: PROTOCOL_VERSION,
    cmd: frame.cmd ?? Command.REQUEST,
    seq: frame.seq,
    opcode: frame.opcode,
    payload: frame.payload,
  }) as string

/**
 * **Never `JSON.parse`.** Chat and message ids are 64-bit and exceed `Number.MAX_SAFE_INTEGER`;
 * the built-in parser rounds them silently, so `7268926000000000001` and `...002` become the same
 * chat. `lossless-json` hands back a bigint for any integer that would not survive, and every id
 * leaves this layer as a string.
 */
export const decodeFrame = (raw: string): InboundFrame => {
  const value = parse(raw, undefined, {
    parseNumber: (text) => (isInteger(text) && !isSafeNumber(text) ? BigInt(text) : Number(text)),
  })

  if (!isRecord(value)) throw new FrameError("a frame that is not an object")

  return {
    ver: header(value.ver, "ver"),
    cmd: header(value.cmd ?? Command.RESPONSE, "cmd"),
    seq: value.seq === null || value.seq === undefined ? null : header(value.seq, "seq"),
    opcode: header(value.opcode, "opcode"),
    payload: isRecord(value.payload) ? value.payload : null,
  }
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

const isRecord = (value: unknown): value is Payload =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const header = (value: unknown, field: string): number => {
  const asNumber = typeof value === "bigint" ? Number(value) : value
  if (typeof asNumber !== "number" || !Number.isSafeInteger(asNumber)) {
    throw new FrameError(`a frame whose \`${field}\` is not a whole number`)
  }
  return asNumber
}
