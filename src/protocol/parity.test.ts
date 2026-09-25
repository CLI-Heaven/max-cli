import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@leemour/cli-core"
import { decode, ExtData } from "@msgpack/msgpack"
import { describe, expect, it } from "vitest"
import { openCache } from "../cache/open.js"
import { openStore } from "../cache/store.js"
import { MaxClient } from "../client.js"
import { Opcode } from "../generated/opcodes.generated.js"
import { SessionStore } from "../session/store.js"
import { mockMax } from "../testing/mock-max.js"
import { Connection } from "./connection.js"
import { decodeHeader, HEADER_BYTES } from "./frame.js"
import { decompressBlock } from "./lz4.js"

/**
 * Our requests beside web.max.ru's, field by field: the names, their order, and whether a value
 * went out as a wrapped id, a bare number, a string or a boolean. The mock speaks our own codec,
 * so without this the whole suite only proves the codec agrees with itself.
 */
type Shape = string | { [key: string]: Shape } | Shape[]

const capture = JSON.parse(
  readFileSync(new URL("../testing/fixtures/web-capture-2026-09-25.json", import.meta.url), "utf8"),
) as { frames: { dir: string; opcode: number; payload?: unknown }[] }

const recorded = (opcode: number): Shape =>
  shapeOfRecorded(capture.frames.find((frame) => frame.dir === "out" && frame.opcode === opcode)?.payload)

const shapeOfRecorded = (value: unknown): Shape => {
  if (typeof value === "boolean") return "bool"
  if (typeof value === "number") return "int"
  if (typeof value === "string") {
    if (/^<(u64|i64)>$/.test(value)) return "int64"
    if (/^<(f32|f64)>$/.test(value)) return "float"
    return /^<(fixint|u8|u16|u32|i8|i16|i32)>$/.test(value) ? "int" : "str"
  }
  if (Array.isArray(value)) return value.map(shapeOfRecorded)
  if (value && typeof value === "object") {
    if ("$ext1" in value) return "ext1"
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOfRecorded(item)]))
  }
  return String(value)
}

const shapeOfOurs = (value: unknown): Shape => {
  if (value instanceof ExtData) return value.type === 1 ? "ext1" : `ext${value.type}`
  if (typeof value === "boolean") return "bool"
  // Decoded with `useBigInt64`, a 64-bit integer comes back a bigint and a float a number.
  if (typeof value === "bigint") return "int64"
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) <= 0xffff_ffff ? "int" : "float"
  if (typeof value === "string") return "str"
  if (Array.isArray(value)) return value.map(shapeOfOurs)
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOfOurs(item)]))
  return String(value)
}

const ours = (bytes: Uint8Array): Shape => {
  const { flags, length } = decodeHeader(bytes)
  let body = bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)
  if (flags > 0) body = decompressBlock(body, flags * length)
  return shapeOfOurs(decode(body, { useBigInt64: true }))
}

describe("our requests beside web.max.ru's", async () => {
  const scripted = () =>
    mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: {
          profile: { contact: { id: 10000001 } },
          chats: [{ id: 111, type: "DIALOG" }],
          contacts: [],
          time: 1_790_328_205_681,
        },
        [Opcode.MSG_GET_REACTIONS]: { messagesReactions: {} },
        [Opcode.CHAT_HISTORY]: { messages: [] },
      },
    })
  const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
  const store = new SessionStore({ keyring: memoryKeyring(), configDir: dir, stateDir: join(dir, "state"), env: {} })
  store.writeToken("a-token")
  const cache = openStore({ database: await openCache(join(dir, "cache.db")) })
  // Twice, so the second login carries the time the first one returned — the request MAX refused
  // while that time went out as a float.
  let max = scripted()
  for (let run = 0; run < 2; run++) {
    max = scripted()
    const client = new MaxClient({
      store,
      cache,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    })
    await client.connect()
    await client.messages.list("111", { limit: 30 })
    await client.close()
  }

  const sent = (opcode: number) => {
    const index = max.sent.findIndex((call) => call.opcode === opcode)
    return ours(max.wire[index] as Uint8Array)
  }

  it("INIT: the same identity fields, in the same order", () => {
    expect(JSON.stringify(sent(Opcode.SESSION_INIT))).toBe(JSON.stringify(recorded(6)))
  })

  it("LOGIN: the same fields, in the same order", () => {
    // The short fixture keeps no LOGIN body — it carries the token. Its shape, from the full capture:
    const web = {
      token: "str",
      chatsCount: "int",
      interactive: "bool",
      chatsSync: "int",
      contactsSync: "int64",
      presenceSync: "int",
      draftsSync: "int",
    }
    expect(JSON.stringify(sent(Opcode.LOGIN))).toBe(JSON.stringify(web))
  })

  it("history: the web client's five fields, the chat id wrapped, and nothing more", () => {
    expect(JSON.stringify(sent(Opcode.CHAT_HISTORY))).toBe(JSON.stringify(recorded(49)))
  })
})
