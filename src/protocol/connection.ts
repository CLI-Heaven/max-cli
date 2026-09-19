import { WebSocket } from "ws"
import { Command, decodeFrame, encodeFrame, type InboundFrame, type Payload } from "./frame.js"

export const MAX_WEBSOCKET_URL = "wss://ws-api.oneme.ru/websocket"
/** MAX's web client sends this; we send what it sends rather than announcing ourselves (§34). */
export const WEB_ORIGIN = "https://web.max.ru"

export interface ConnectionOptions {
  url?: string
  origin?: string
  /** Per request, not per connection. */
  timeoutMs?: number
  /** Events MAX pushes on its own — messages arriving, presence. Ignored unless a caller cares. */
  onEvent?: (frame: InboundFrame) => void
  /** Injected in tests; defaults to the real `ws` client. */
  createSocket?: (url: string, origin: string) => WebSocket
}

export class ProtocolError extends Error {
  readonly opcode: number
  readonly payload: Payload | null

  constructor(message: string, opcode: number, payload: Payload | null) {
    super(message)
    this.name = "ProtocolError"
    this.opcode = opcode
    this.payload = payload
  }
}

/**
 * One WebSocket, one command's worth of work, then closed.
 *
 * **Everything that could keep the process alive is owned here**: the socket, the per-request
 * timers and the listeners. `close()` clears all three, and a command that opens a connection
 * closes it in a `finally` — a CLI that prints its result and then hangs is a defect, not a rough
 * edge (REQUIREMENTS §18).
 */
export class Connection {
  readonly #url: string
  readonly #origin: string
  readonly #timeoutMs: number
  readonly #onEvent: ((frame: InboundFrame) => void) | undefined
  readonly #createSocket: (url: string, origin: string) => WebSocket
  readonly #pending = new Map<
    number,
    { resolve: (frame: InboundFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  #socket: WebSocket | undefined
  #seq = 0
  #closed = false

  constructor(options: ConnectionOptions = {}) {
    this.#url = options.url ?? MAX_WEBSOCKET_URL
    this.#origin = options.origin ?? WEB_ORIGIN
    this.#timeoutMs = options.timeoutMs ?? 30_000
    this.#onEvent = options.onEvent
    this.#createSocket = options.createSocket ?? ((url, origin) => new WebSocket(url, { headers: { Origin: origin } }))
  }

  async open(): Promise<void> {
    if (this.#socket) return

    const socket = this.#createSocket(this.#url, this.#origin)
    this.#socket = socket

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.off("error", onError)
        resolve()
      }
      const onError = (error: Error) => {
        socket.off("open", onOpen)
        reject(error)
      }
      socket.once("open", onOpen)
      socket.once("error", onError)
    })

    socket.on("message", (data: Buffer | string) => this.#receive(String(data)))
    socket.on("close", () => this.#failAll(new Error("MAX closed the connection")))
    socket.on("error", (error: Error) => this.#failAll(error))
  }

  /**
   * Sends one request and waits for the response carrying the same `seq`.
   *
   * MAX interleaves pushed events with responses on one socket, so the `seq` is the only thing
   * tying an answer to its question — a reader that takes the next frame as its answer will
   * eventually read somebody's incoming message instead.
   */
  async invoke(opcode: number, payload: Payload = {}): Promise<Payload> {
    if (!this.#socket) throw new Error("the connection is not open")
    if (this.#closed) throw new Error("the connection is closed")

    this.#seq += 1
    const seq = this.#seq
    const socket = this.#socket

    const frame = await new Promise<InboundFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq)
        reject(new Error(`MAX did not answer opcode ${opcode} within ${this.#timeoutMs}ms`))
      }, this.#timeoutMs)

      this.#pending.set(seq, { resolve, reject, timer })
      socket.send(encodeFrame({ seq, opcode, payload }))
    })

    if (frame.cmd === Command.ERROR) {
      const reason = typeof frame.payload?.error === "string" ? frame.payload.error : "an error with no reason given"
      throw new ProtocolError(`MAX refused opcode ${opcode}: ${reason}`, opcode, frame.payload)
    }

    return frame.payload ?? {}
  }

  async close(): Promise<void> {
    this.#closed = true
    const socket = this.#socket
    this.#socket = undefined

    for (const { timer } of this.#pending.values()) clearTimeout(timer)
    this.#pending.clear()

    if (!socket) return
    socket.removeAllListeners()
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close()
  }

  #receive(raw: string): void {
    let frame: InboundFrame
    try {
      frame = decodeFrame(raw)
    } catch {
      return // A frame we cannot read is not a reason to fail a request we can.
    }

    const waiting = frame.seq === null ? undefined : this.#pending.get(frame.seq)
    if (!waiting) {
      this.#onEvent?.(frame)
      return
    }

    clearTimeout(waiting.timer)
    this.#pending.delete(frame.seq as number)
    waiting.resolve(frame)
  }

  #failAll(error: Error): void {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.#pending.clear()
  }
}
