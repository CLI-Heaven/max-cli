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

  it("times out one request without waiting for the whole command", async () => {
    const max = mockMax({ answers: { 6: silent } })
    const connection = new Connection({ createSocket: max.createSocket, timeoutMs: 20 })
    await connection.open()

    await expect(connection.invoke(6, {})).rejects.toThrow(/within 20ms/)
    await connection.close()
  })
})
