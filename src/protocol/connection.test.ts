import { describe, expect, it } from "vitest"
import { mockMax } from "../testing/mock-max.js"
import { Connection } from "./connection.js"
import { encodeFrame } from "./frame.js"

/** Scripted silence: MAX accepts the frame and never answers it. */
const silent = () => undefined

describe("the connection", () => {
  it("**settles a request that was in flight when it closed**, instead of leaving it forever", async () => {
    const max = mockMax({ answers: { 6: silent } })
    const connection = new Connection({ createSocket: max.createSocket, timeoutMs: 60_000 })
    await connection.open()

    const inFlight = connection.invoke(6, {})
    const outcome = Promise.race([
      inFlight.then(() => "resolved").catch((error: Error) => error.message),
      new Promise((resolve) => setTimeout(() => resolve("never settled"), 300)),
    ])

    await connection.close()

    // Closing used to clear the pending map without rejecting, and it cleared the request's timer
    // and removed the socket's listeners in the same breath — so nothing was left that could ever
    // settle the caller's promise. A command that closes while a request is out would hang, which
    // is the one defect REQUIREMENTS §18 is about.
    expect(await outcome).toContain("closed before MAX answered")
  })

  it("**survives the error `ws` emits when a socket is closed mid-connect**", async () => {
    const max = mockMax({ answers: { 6: silent } })
    const connection = new Connection({ createSocket: max.createSocket, timeoutMs: 60_000 })
    await connection.open()

    // Closing used to strip every listener and *then* close, so this error had nobody to hear it
    // — and an unheard `error` event takes the whole process down. Against the real service that
    // turned `--timeout` into exit 1 and a dump of `ws` internals rather than exit 9 and a
    // sentence. Found by running it, not by a test; the test exists so it stays found.
    await expect(connection.close()).resolves.toBeUndefined()
    expect(max.closed).toBe(true)
  })

  it("times out one request without waiting for the whole command", async () => {
    const max = mockMax({ answers: { 6: silent } })
    const connection = new Connection({ createSocket: max.createSocket, timeoutMs: 20 })
    await connection.open()

    await expect(connection.invoke(6, {})).rejects.toThrow(/within 20ms/)
    await connection.close()
  })

  it("never takes a push for the answer to a request, even with the same `seq`", async () => {
    const max = mockMax({ answers: { 49: () => undefined } })
    const events: number[] = []
    const connection = new Connection({ createSocket: max.createSocket, onEvent: (frame) => events.push(frame.opcode) })
    await connection.open()

    const request = connection.invoke(49, {}).catch((error: Error) => error.message)
    max.push(128, { chatId: 1, message: { id: 5 } }, 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await connection.close()

    expect(events).toEqual([128])
    expect(await request).toContain("closed before MAX answered")
  })

  it("fails a request with the reason when its answer cannot be read, instead of timing out", async () => {
    const max = mockMax({ answers: { 19: silent } })
    const connection = new Connection({ createSocket: max.createSocket, timeoutMs: 60_000 })
    await connection.open()

    const request = connection.invoke(19, { token: "t" })
    const zstd = encodeFrame({ seq: 0, opcode: 19, cmd: 1 })
    zstd[6] = 0xff
    max.pushBytes(zstd)

    await expect(request).rejects.toThrow(/zstd/)
    await connection.close()
  })

  it("does not fail a request over an unreadable push that happens to share its seq", async () => {
    const max = mockMax({ answers: { 49: silent } })
    const connection = new Connection({ createSocket: max.createSocket, timeoutMs: 40 })
    await connection.open()

    const request = connection.invoke(49, {})
    const push = encodeFrame({ seq: 0, opcode: 128, cmd: 2 })
    push[6] = 0xff
    max.pushBytes(push)

    await expect(request).rejects.toThrow(/within 40ms/)
    await connection.close()
  })

  describe("live", () => {
    const live = (onClose?: (error: Error) => void) => {
      const max = mockMax({ answers: {} })
      const events: number[] = []
      const connection = new Connection({
        createSocket: max.createSocket,
        live: true,
        onEvent: (frame) => events.push(frame.opcode),
        ...(onClose ? { onClose } : {}),
      })
      return { max, events, connection }
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

    it("answers MAX's ping with no payload, as the web client does, and keeps it to itself", async () => {
      const { max, events, connection } = live()
      await connection.open()

      max.push(1, {}, 7)
      await settle()
      await connection.close()

      expect(max.answered).toEqual([{ opcode: 1, seq: 7, payload: null }])
      expect(events).toEqual([])
    })

    it("acknowledges a new message with the ids it came with, and passes it on", async () => {
      const { max, events, connection } = live()
      await connection.open()

      max.push(128, { chatId: -70000000000001, message: { id: 116762160362694583n, text: "hi" } }, 3)
      await settle()
      await connection.close()

      expect(max.answered).toEqual([
        { opcode: 128, seq: 3, payload: { chatId: -70000000000001, messageId: 116762160362694583n } },
      ])
      expect(events).toEqual([128])
      expect(max.sent.map((call) => call.opcode)).not.toContain(50)
    })

    it("drops a push it has already seen", async () => {
      const { max, events, connection } = live()
      await connection.open()

      max.push(130, {}, 4)
      max.push(130, {}, 4)
      max.push(130, {}, 2)
      await settle()
      await connection.close()

      expect(events).toEqual([130])
    })

    it("keeps delivering pushes after the two-byte seq wraps, and still drops a repeat", async () => {
      const { max, events, connection } = live()
      await connection.open()

      for (const seq of [65_534, 65_535, 0, 1, 65_535]) max.push(130, { seq }, seq)
      await settle()
      await connection.close()

      expect(events).toEqual([130, 130, 130, 130])
    })

    it("delivers a first push whose seq is 0", async () => {
      const { max, events, connection } = live()
      await connection.open()

      max.push(130, {}, 0)
      await settle()
      await connection.close()

      expect(events).toEqual([130])
    })

    it("survives a new message whose id is nested too deep to send back, and does not acknowledge it", async () => {
      const max = mockMax({ answers: { 48: { ok: true } } })
      const errors: string[] = []
      const connection = new Connection({
        createSocket: max.createSocket,
        live: true,
        onError: (error) => errors.push(error.message),
      })
      await connection.open()

      max.pushBytes(pushOf(128, deepId(150)))
      await settle()

      expect(max.answered).toEqual([])
      await expect(connection.invoke(48, {})).resolves.toMatchObject({ ok: true })
      await connection.close()
    })

    it("reports a push its listener could not handle, and carries on", async () => {
      const max = mockMax({ answers: { 48: { ok: true } } })
      const errors: string[] = []
      const connection = new Connection({
        createSocket: max.createSocket,
        live: true,
        onEvent: () => {
          throw new Error("listener broke")
        },
        onError: (error) => errors.push(error.message),
      })
      await connection.open()

      max.push(130, {}, 1)
      await settle()

      expect(errors).toEqual(["listener broke"])
      await expect(connection.invoke(48, {})).resolves.toMatchObject({ ok: true })
      await connection.close()
    })

    it("says when MAX drops it, and refuses the next request at once instead of timing out", async () => {
      const closes: string[] = []
      const { max, connection } = live((error) => closes.push(error.message))
      await connection.open()

      max.drop()
      await settle()

      expect(closes).toEqual(["MAX closed the connection"])
      await expect(connection.invoke(49, {})).rejects.toThrow("closed")
      await connection.close()
    })

    it("names the close code and reason MAX gave, since they tell a session ended from a network drop", async () => {
      const closes: string[] = []
      const { max, connection } = live((error) => closes.push(error.message))
      await connection.open()

      max.drop(4001, "session\nclosed")
      await settle()

      expect(closes).toEqual(["MAX closed the connection (code 4001: session closed)"])
      await connection.close()
    })
  })
})

const str = (text: string) => [0xa0 | text.length, ...Buffer.from(text)]

/** `{ chatId: 1, message: { id: [[…[1]…]] } }`, written by hand: our encoder refuses that depth. */
const deepId = (depth: number): Uint8Array =>
  Uint8Array.from([
    0x82,
    ...str("chatId"),
    0x01,
    ...str("message"),
    0x81,
    ...str("id"),
    ...Array(depth).fill(0x91),
    0x01,
  ])

const pushOf = (opcode: number, body: Uint8Array): Uint8Array => {
  const header = new DataView(new ArrayBuffer(10))
  header.setUint8(0, 10)
  header.setUint8(1, 0)
  header.setUint16(2, 1)
  header.setUint16(4, opcode)
  header.setUint32(6, body.length)
  return Uint8Array.from([...new Uint8Array(header.buffer), ...body])
}
