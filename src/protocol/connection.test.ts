import { describe, expect, it } from "vitest"
import { mockMax } from "../testing/mock-max.js"
import { Connection } from "./connection.js"

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
    max.push(128, { chatId: 1, message: { id: 5 } }, 1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await connection.close()

    expect(events).toEqual([128])
    expect(await request).toContain("closed before MAX answered")
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

    it("acknowledges a new message with its ids as numbers on the wire, as they came, and passes it on", async () => {
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
  })
})
