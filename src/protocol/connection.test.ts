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
})
