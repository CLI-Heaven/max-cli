import { describe, expect, it } from "vitest"
import { withDeadline } from "./deadline.js"

const never = () => new Promise<never>(() => {})

const closeable = () => {
  const state = { closed: false }
  return {
    state,
    handle: {
      close: async () => {
        state.closed = true
      },
    },
  }
}

describe("the command deadline", () => {
  it("**ends a command that overruns**, with a code a script can branch on", async () => {
    const failure = await withDeadline(40, [], never).catch((error: Error) => error)

    expect(failure).toMatchObject({ code: "timeout" })
    expect(String(failure)).toContain("--timeout")
  })

  it("**closes what it was holding**, or the process outlives the message it printed", async () => {
    // Racing a promise only decides what gets printed. The losing work carries on, and an open
    // WebSocket keeps Node alive — so the command would report a timeout and then sit there,
    // which is worse than the wait it was cutting short (§18).
    const socket = closeable()

    await withDeadline(40, [socket.handle], never).catch(() => {})

    expect(socket.state.closed).toBe(true)
  })

  it("closes every one of them, not only the first", async () => {
    const one = closeable()
    const two = closeable()

    await withDeadline(40, [one.handle, two.handle], never).catch(() => {})

    expect([one.state.closed, two.state.closed]).toEqual([true, true])
  })

  it("leaves the ordinary path alone when no bound was asked for", async () => {
    expect(await withDeadline(undefined, [], async () => "done")).toBe("done")
  })

  it("does not fire, and closes nothing, when the command finishes in time", async () => {
    const socket = closeable()

    expect(await withDeadline(60_000, [socket.handle], async () => "done")).toBe("done")
    expect(socket.state.closed).toBe(false)
  })
})
