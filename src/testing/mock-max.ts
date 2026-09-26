import { EventEmitter } from "node:events"
import type { WebSocket } from "ws"
import { Command, decodeFrame, encodeFrame, type Payload } from "../protocol/frame.js"

export interface MockMaxOptions {
  /**
   * One answer per opcode. An opcode with no answer is an unexpected call, and the test fails.
   * A function may return `undefined` to stay silent, which is how a timeout is scripted — and
   * the only way a test says it means a request to go unanswered. It is handed the request, so
   * one answer can differ by chat.
   */
  answers: Record<number, Payload | ((request: Payload) => Payload | undefined)>
  /** Opcodes to refuse, as MAX does: `cmd=3` with an `error` in the payload. A function may answer `undefined` to let one through. */
  refuse?: Record<number, string | (() => string | undefined)>
}

export interface MockMax {
  createSocket: () => WebSocket
  /** Every request sent, in order — what the code under test actually asked MAX for. */
  sent: { opcode: number; payload: Payload }[]
  /** The same requests as bytes, for a test about what went on the wire rather than what it meant. */
  wire: Uint8Array[]
  /** Calls with no scripted answer. Any left at the end of a test fail it (`unscripted.ts`). */
  unexpected: number[]
  /** What the client answered to MAX's own frames — a ping, a new message. */
  answered: { opcode: number; seq: number; payload: Payload | null }[]
  closed: boolean
  /** MAX sends a frame of its own, as it does when a message arrives. */
  push: (opcode: number, payload: Payload, seq: number) => void
  /** MAX drops the socket from its side. */
  drop: (code?: number, reason?: string) => void
  /** Bytes exactly as given — for a frame no encoder of ours would write. */
  pushBytes: (bytes: Uint8Array) => void
}

const built: MockMax[] = []

/** Every mock built since the last call, and forgets them — so each test sees only its own. */
export const takeBuiltMocks = (): MockMax[] => built.splice(0)

/**
 * MAX, scripted. **No timers, no network, no waiting**: an answer is delivered on the next tick,
 * so a timeout test costs nothing and a suite cannot reach the real service.
 *
 * It records what was sent, which is how "reading history never marks anything read" is a test
 * rather than a hope: assert that opcode 50 is absent from `sent`.
 */
export const mockMax = ({ answers, refuse = {} }: MockMaxOptions): MockMax => {
  // Open when asked for, as a real socket does — not when the mock is built, or a connection made
  // later than the same tick waits for an event that already fired.
  const createSocket = () => {
    queueMicrotask(() => socket.emit("open"))
    return socket as unknown as WebSocket
  }
  const state: MockMax = {
    createSocket,
    sent: [],
    wire: [],
    unexpected: [],
    answered: [],
    closed: false,
    push: (opcode, payload, seq) => socket.answer({ seq, opcode, payload, cmd: Command.REQUEST }),
    drop: (code?: number, reason?: string) =>
      queueMicrotask(() =>
        code === undefined ? socket.emit("close") : socket.emit("close", code, Buffer.from(reason ?? "")),
      ),
    pushBytes: (bytes) => queueMicrotask(() => socket.emit("message", Buffer.from(bytes))),
  }
  built.push(state)

  const socket = new (class extends EventEmitter {
    readyState = 1
    readonly OPEN = 1
    readonly CONNECTING = 0
    readonly CLOSING = 2

    send(raw: Uint8Array): void {
      const frame = decodeFrame(raw)
      if (frame.cmd === Command.RESPONSE) {
        state.answered.push({ opcode: frame.opcode, seq: frame.seq, payload: frame.payload })
        return
      }
      state.sent.push({ opcode: frame.opcode, payload: frame.payload ?? {} })
      state.wire.push(Uint8Array.from(raw))

      const rule = refuse[frame.opcode]
      const refusal = typeof rule === "function" ? rule() : rule
      if (refusal !== undefined) {
        this.answer({ seq: frame.seq, opcode: frame.opcode, payload: { error: refusal }, cmd: Command.ERROR })
        return
      }

      const answer = answers[frame.opcode]
      if (answer === undefined) {
        state.unexpected.push(frame.opcode)
        return
      }

      const payload = typeof answer === "function" ? answer(frame.payload ?? {}) : answer
      if (payload === undefined) return // Silence: the caller will time out, as MAX sometimes does.

      this.answer({ seq: frame.seq, opcode: frame.opcode, payload, cmd: Command.RESPONSE })
    }

    answer(frame: { seq: number; opcode: number; payload: Payload; cmd: Command }): void {
      queueMicrotask(() => this.emit("message", Buffer.from(encodeFrame(frame))))
    }

    /**
     * ⚠ **Emits `error` on the way out, the way `ws` does when a socket is closed before it
     * finished connecting** — measured against the real service on 2026-09-22.
     *
     * It is here so the suite can see what that costs: an `error` event with nobody listening is
     * how Node kills the process, so a connection that strips its listeners before closing turns
     * a timeout into a stack trace. A mock that closed politely would have let that ship.
     */
    close(): void {
      state.closed = true
      this.readyState = 3
      this.emit("error", new Error("WebSocket was closed before the connection was established"))
    }
  })()

  return state
}
