import { EventEmitter } from "node:events"
import type { WebSocket } from "ws"
import { Command, decodeFrame, encodeFrame, type Payload } from "../protocol/frame.js"

export interface MockMaxOptions {
  /** One answer per opcode. An opcode with no answer is an unexpected call, and the test fails. */
  /** A function may return `undefined` to stay silent, which is how a timeout is scripted. */
  answers: Record<number, Payload | (() => Payload | undefined)>
  /** Opcodes to refuse, as MAX does: `cmd=3` with an `error` in the payload. */
  refuse?: Record<number, string>
}

export interface MockMax {
  createSocket: () => WebSocket
  /** Every request sent, in order — what the code under test actually asked MAX for. */
  sent: { opcode: number; payload: Payload }[]
  /** Calls with no scripted answer. A test that ignores these can pass for the wrong reason. */
  unexpected: number[]
  closed: boolean
}

/**
 * MAX, scripted. **No timers, no network, no waiting**: an answer is delivered on the next tick,
 * so a timeout test costs nothing and a suite cannot reach the real service.
 *
 * It records what was sent, which is how "reading history never marks anything read" is a test
 * rather than a hope: assert that opcode 50 is absent from `sent`.
 */
export const mockMax = ({ answers, refuse = {} }: MockMaxOptions): MockMax => {
  const state: MockMax = { createSocket: () => socket as unknown as WebSocket, sent: [], unexpected: [], closed: false }

  const socket = new (class extends EventEmitter {
    readyState = 1
    readonly OPEN = 1
    readonly CONNECTING = 0
    readonly CLOSING = 2

    send(raw: string): void {
      const frame = decodeFrame(raw)
      state.sent.push({ opcode: frame.opcode, payload: frame.payload ?? {} })

      const refusal = refuse[frame.opcode]
      if (refusal !== undefined) {
        this.answer({ seq: frame.seq ?? 0, opcode: frame.opcode, payload: { error: refusal }, cmd: Command.ERROR })
        return
      }

      const answer = answers[frame.opcode]
      if (answer === undefined) {
        state.unexpected.push(frame.opcode)
        return
      }

      const payload = typeof answer === "function" ? answer() : answer
      if (payload === undefined) return // Silence: the caller will time out, as MAX sometimes does.

      this.answer({ seq: frame.seq ?? 0, opcode: frame.opcode, payload, cmd: Command.RESPONSE })
    }

    answer(frame: { seq: number; opcode: number; payload: Payload; cmd: Command }): void {
      queueMicrotask(() => this.emit("message", encodeFrame(frame)))
    }

    close(): void {
      state.closed = true
      this.readyState = 3
    }
  })()

  queueMicrotask(() => socket.emit("open"))
  return state
}
