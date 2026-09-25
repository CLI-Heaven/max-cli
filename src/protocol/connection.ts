import { WebSocket } from "ws"
import {
  Command,
  decodeFrame,
  decodeHeader,
  encodeFrame,
  type InboundFrame,
  type Payload,
  SEQ_MODULO,
} from "./frame.js"

/** Where web.max.ru connects, read off its live socket on 2026-09-25. */
export const MAX_WEBSOCKET_URL = "wss://api.oneme.ru/websocket"
/** MAX's web client sends this; we send what it sends rather than announcing ourselves (§34). */
export const WEB_ORIGIN = "https://web.max.ru"

/**
 * What one frame cost, reported as it happens.
 *
 * The transport is the only layer that knows the `seq` it allocated and how many bytes actually
 * went over the socket, and it is the only one that can time the wait. It reports those and
 * nothing else — **who is asking, and why, stays above it** (`ARCHITECTURE.md` §2).
 */
export interface WireEvent {
  phase: "sent" | "received"
  seq: number
  opcode: number
  bytes: number
}

export interface ConnectionOptions {
  url?: string
  origin?: string
  /** Per request, not per connection. */
  timeoutMs?: number
  /** Events MAX pushes on its own — messages arriving, presence. Ignored unless a caller cares. */
  onEvent?: (frame: InboundFrame) => void
  /**
   * **A connection that stays open**, as `max serve`'s does: it answers MAX's ping and acknowledges
   * a new message the way web.max.ru does (bundle read 2026-09-24), and drops a push it has already
   * seen. Off for a one-shot command, which is gone before either matters.
   */
  live?: boolean
  /** MAX closed the socket. Not called for our own `close()`. The connection is dead after it. */
  onClose?: (error: Error) => void
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
/** MAX's keep-alive, both directions. */
const PING = 1
/** A message arrived. The web client acknowledges each one. */
const NEW_MESSAGE = 128

/** What a client needs of a connection — so one that goes through `max serve` can stand in. */
export type Wire = Pick<Connection, "open" | "invoke" | "close">

export class Connection {
  readonly #url: string
  readonly #origin: string
  readonly #timeoutMs: number
  readonly #onEvent: ((frame: InboundFrame) => void) | undefined
  readonly #live: boolean
  readonly #onClose: ((error: Error) => void) | undefined
  readonly #createSocket: (url: string, origin: string) => WebSocket
  readonly #pending = new Map<
    number,
    {
      resolve: (answer: { frame: InboundFrame; bytes: number }) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  #socket: WebSocket | undefined
  #seq = 0
  #lastPush: number | undefined
  #closed = false

  constructor(options: ConnectionOptions = {}) {
    this.#url = options.url ?? MAX_WEBSOCKET_URL
    this.#origin = options.origin ?? WEB_ORIGIN
    this.#timeoutMs = options.timeoutMs ?? 30_000
    this.#onEvent = options.onEvent
    this.#live = options.live ?? false
    this.#onClose = options.onClose
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

    socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => this.#receive(asBytes(data)))
    socket.on("close", () => this.#lost(new Error("MAX closed the connection")))
    socket.on("error", (error: Error) => this.#lost(error))
  }

  /**
   * Sends one request and waits for the response carrying the same `seq`.
   *
   * MAX interleaves pushed events with responses on one socket, so the `seq` is the only thing
   * tying an answer to its question — a reader that takes the next frame as its answer will
   * eventually read somebody's incoming message instead.
   *
   * `watch` is told what left and what came back, for the caller that is keeping a diagnostic. It
   * is called synchronously on the way out, so a request that never gets an answer is still on
   * record — which is the run somebody actually wants to read.
   */
  async invoke(opcode: number, payload: Payload = {}, watch?: (event: WireEvent) => void): Promise<Payload> {
    if (!Number.isInteger(opcode)) {
      // A typo in an opcode constant is otherwise a round trip to MAX that comes back
      // "неизвестный opcode", which reads as the protocol's fault rather than ours.
      throw new Error(`refusing to send a frame with a non-integer opcode: ${String(opcode)}`)
    }
    if (this.#closed) throw new Error("the connection is closed")
    if (!this.#socket) throw new Error("the connection is not open")

    // The web client's INIT goes out as seq 0; the header holds two bytes, so the count wraps.
    const seq = this.#seq
    this.#seq = (this.#seq + 1) % SEQ_MODULO
    const socket = this.#socket

    const answer = await new Promise<{ frame: InboundFrame; bytes: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(seq)
        reject(new Error(`MAX did not answer opcode ${opcode} within ${this.#timeoutMs}ms`))
      }, this.#timeoutMs)

      this.#pending.set(seq, { resolve, reject, timer })
      const sent = encodeFrame({ seq, opcode, payload })
      socket.send(sent)
      watch?.({ phase: "sent", seq, opcode, bytes: sent.length })
    })

    const frame = answer.frame
    watch?.({ phase: "received", seq, opcode, bytes: answer.bytes })

    if (frame.cmd === Command.ERROR) {
      const reason = typeof frame.payload?.error === "string" ? frame.payload.error : "an error with no reason given"
      throw new ProtocolError(`MAX refused opcode ${opcode}: ${reason}`, opcode, frame.payload)
    }

    return frame.payload ?? {}
  }

  /**
   * Closes the socket and **settles anything still waiting**, rather than dropping it.
   *
   * ⚠ It used to clear the pending map without rejecting, which left the caller of an in-flight
   * `invoke` awaiting a promise nothing could ever settle: the timers were cleared and the socket
   * listeners removed in the same breath, so neither the timeout nor the close event was left to
   * fire. Invisible in normal use, because `close()` runs in a `finally` once the body is done —
   * and a hang the moment anything closes the connection while a request is out, which is exactly
   * what a whole-command deadline does. Found by a test, not by a user.
   */
  async close(): Promise<void> {
    this.#closed = true
    const socket = this.#socket
    this.#socket = undefined

    this.#failAll(new Error("the connection was closed before MAX answered"))

    if (!socket) return
    socket.removeAllListeners()

    // ⚠ **An error listener has to survive the close.** `ws` emits `error` when a socket is closed
    // while it is still CONNECTING — measured against the real service — and an `error` event with
    // no listener is how Node kills the whole process. Removing every listener and *then* closing
    // turned a timeout into an unhandled event and a stack trace: exit 1 and a dump of `ws`
    // internals, instead of exit 9 and one sentence.
    //
    // Nothing here can act on such an error anyway. The connection is being discarded; the socket
    // failing to shut politely changes nothing a caller could use.
    socket.on("error", () => {})
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close()
  }

  #receive(raw: Uint8Array): void {
    let frame: InboundFrame
    try {
      frame = decodeFrame(raw)
    } catch (error) {
      // A body we cannot read still has a header naming the request it answers. Failing that
      // request with the reason beats letting it wait out its timeout as "MAX did not answer".
      const header = safeHeader(raw)
      const answers = header && (header.cmd === Command.RESPONSE || header.cmd === Command.ERROR)
      const waiting = answers ? this.#pending.get(header.seq) : undefined
      if (!header || !waiting) return
      clearTimeout(waiting.timer)
      this.#pending.delete(header.seq)
      waiting.reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    // MAX numbers its own frames, so a push can carry the very `seq` a request is waiting on. Only
    // `cmd` tells an answer from a push — a lookup by `seq` alone once resolved a request with
    // somebody's incoming message.
    if (frame.cmd !== Command.RESPONSE && frame.cmd !== Command.ERROR) {
      this.#pushed(frame)
      return
    }

    const waiting = this.#pending.get(frame.seq)
    if (!waiting) return

    clearTimeout(waiting.timer)
    this.#pending.delete(frame.seq)
    waiting.resolve({ frame, bytes: raw.length })
  }

  #pushed(frame: InboundFrame): void {
    if (this.#live) {
      // After a hiccup MAX sends some pushes again; the web client drops anything not newer.
      // "Newer" is modular: a two-byte seq wraps, and a plain `<=` would drop every push after it.
      if (this.#lastPush !== undefined && !isAfter(frame.seq, this.#lastPush)) return
      this.#lastPush = frame.seq

      if (frame.opcode === PING) {
        this.#answer({ cmd: Command.RESPONSE, seq: frame.seq, opcode: PING })
        return
      }
      const message = frame.payload?.message
      if (frame.opcode === NEW_MESSAGE && typeof message === "object" && message !== null && "id" in message) {
        // As bigints, so they go back wrapped the way the web client wraps an id.
        this.#answer({
          cmd: Command.RESPONSE,
          seq: frame.seq,
          opcode: NEW_MESSAGE,
          payload: { chatId: asWireId(frame.payload?.chatId), messageId: asWireId(message.id) },
        })
      }
    }
    this.#onEvent?.(frame)
  }

  #answer(frame: Parameters<typeof encodeFrame>[0]): void {
    const socket = this.#socket
    if (socket && !this.#closed) socket.send(encodeFrame(frame))
  }

  /** MAX dropped us: every waiting request fails now, and the next `invoke` refuses at once. */
  #lost(error: Error): void {
    if (this.#closed) return
    this.#closed = true
    const socket = this.#socket
    this.#socket = undefined
    if (socket) {
      // A dead connection must hear nothing more, or a reconnect's frames reach it twice.
      socket.removeAllListeners()
      socket.on("error", () => {})
    }
    this.#failAll(error)
    this.#onClose?.(error)
  }

  #failAll(error: Error): void {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.#pending.clear()
  }
}

const asBytes = (data: Buffer | ArrayBuffer | Buffer[]): Uint8Array => {
  if (Array.isArray(data)) return Buffer.concat(data)
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data
}

const safeHeader = (raw: Uint8Array): ReturnType<typeof decodeHeader> | undefined => {
  try {
    return decodeHeader(raw)
  } catch {
    return undefined
  }
}

const isAfter = (seq: number, last: number): boolean => {
  const distance = (seq - last + SEQ_MODULO) % SEQ_MODULO
  return distance > 0 && distance < SEQ_MODULO / 2
}

const asWireId = (value: unknown): unknown =>
  typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : value
