import { connect, type Socket } from "node:net"
import { Opcode } from "../generated/opcodes.generated.js"
import { Connection, ProtocolError, type Wire, type WireEvent } from "../protocol/connection.js"
import type { Payload } from "../protocol/frame.js"
import { startSession } from "../session/handshake.js"
import type { SessionStore } from "../session/store.js"
import { buildRequest } from "../spec/index.js"
import { fromLine, lineReader, toLine } from "./lines.js"

interface Pending {
  resolve: (answer: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * **A command's connection that goes through `max serve`** when one is running (`MAX-16`).
 *
 * INIT and LOGIN are answered by the server's own login, so the command logs in without logging
 * in. Reads go through the server's connection. **Anything else — a send, a reaction — makes this
 * open a connection of its own and log in on it**, so it passes the send guards exactly as it does
 * without a server (`NEED-185`). No server, a stale login, or a server that stops answering: the
 * whole command falls back to its own connection before it has sent anything.
 */
export class ServerConnection implements Wire {
  readonly #path: string
  readonly #store: SessionStore
  readonly #timeoutMs: number
  readonly #direct: () => Connection
  readonly #pending = new Map<number, Pending>()
  #socket: Socket | undefined
  #id = 0
  #login: Payload | undefined
  /** What the client sent as INIT; a fallback at LOGIN has to send it first, or MAX refuses. */
  #init: Payload | undefined
  #own: Connection | undefined
  #ownLoggedIn = false

  constructor({
    path,
    store,
    timeoutMs = 30_000,
    direct,
  }: {
    path: string
    store: SessionStore
    timeoutMs?: number
    direct?: () => Connection
  }) {
    this.#path = path
    this.#store = store
    this.#timeoutMs = timeoutMs
    this.#direct = direct ?? (() => new Connection({ timeoutMs }))
  }

  async open(): Promise<void> {}

  async invoke(opcode: number, payload: Payload = {}, watch?: (event: WireEvent) => void): Promise<Payload> {
    if (this.#own) return this.#ownRequest(opcode, payload, watch)

    if (opcode === Opcode.SESSION_INIT) {
      this.#init = payload
      this.#login = await this.#ask({ login: true }).catch(() => undefined)
      if (!this.#login) return this.#fallBack(opcode, payload, watch)
      return {}
    }
    if (opcode === Opcode.LOGIN) {
      // A token being tried out (`max session start`) is not the one the server logged in with.
      if (!this.#login || payload.token !== this.#store.readToken()) return this.#fallBack(opcode, payload, watch)
      return this.#login
    }
    if (!READS.has(opcode)) return this.#ownRequest(opcode, payload, watch)

    watch?.({ phase: "sent", seq: this.#id + 1, opcode, bytes: 0 })
    const answer = await this.#ask({ opcode, payload })
    watch?.({ phase: "received", seq: this.#id, opcode, bytes: 0 })
    return answer
  }

  async close(): Promise<void> {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer)
      reject(new Error("the connection was closed before max serve answered"))
    }
    this.#pending.clear()
    this.#socket?.destroy()
    this.#socket = undefined
    await this.#own?.close()
  }

  /** Before anything was sent: the command simply runs as it would with no server. */
  async #fallBack(opcode: number, payload: Payload, watch?: (event: WireEvent) => void): Promise<Payload> {
    this.#socket?.destroy()
    this.#socket = undefined
    this.#own = this.#direct()
    await this.#own.open()
    if (opcode === Opcode.LOGIN && this.#init) await this.#own.invoke(Opcode.SESSION_INIT, this.#init)
    this.#ownLoggedIn = opcode === Opcode.LOGIN
    return this.#own.invoke(opcode, payload, watch)
  }

  /** A write mid-command: a connection of its own, logged in, then the request. */
  async #ownRequest(opcode: number, payload: Payload, watch?: (event: WireEvent) => void): Promise<Payload> {
    if (!this.#own) {
      this.#own = this.#direct()
      await this.#own.open()
    }
    const own = this.#own
    if (!this.#ownLoggedIn && opcode !== Opcode.SESSION_INIT && opcode !== Opcode.LOGIN) {
      const token = this.#store.readToken() ?? ""
      await startSession((operation, request) => own.invoke(operation.opcode, buildRequest(operation, request)), {
        token,
        deviceId: this.#store.readState().deviceId,
      })
      this.#ownLoggedIn = true
    }
    if (opcode === Opcode.LOGIN) this.#ownLoggedIn = true
    return own.invoke(opcode, payload, watch)
  }

  async #ask(request: Record<string, unknown>): Promise<Payload> {
    const socket = await this.#connected()
    this.#id += 1
    const id = this.#id
    const answer = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`max serve did not answer within ${this.#timeoutMs}ms`))
      }, this.#timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      socket.write(toLine({ id, ...request }))
    })

    const error = answer.error as { code?: string; message?: string; payload?: Payload } | undefined
    if (error?.code === "refused") {
      throw new ProtocolError(error.message ?? "MAX refused it", Number(request.opcode), error.payload ?? null)
    }
    if (error) throw new Error(error.message ?? "max serve could not do it")
    return (answer.payload ?? {}) as Payload
  }

  async #connected(): Promise<Socket> {
    if (this.#socket) return this.#socket
    const socket = connect(this.#path)
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve())
      socket.once("error", reject)
    })
    socket.on(
      "data",
      lineReader((line) => {
        const answer = fromLine(line)
        const waiting = this.#pending.get(Number(answer.id))
        if (!waiting) return
        clearTimeout(waiting.timer)
        this.#pending.delete(Number(answer.id))
        waiting.resolve(answer)
      }),
    )
    socket.on("error", () => {})
    socket.on("close", () => {
      for (const { reject, timer } of this.#pending.values()) {
        clearTimeout(timer)
        reject(new Error("max serve went away"))
      }
      this.#pending.clear()
      this.#socket = undefined
    })
    this.#socket = socket
    return socket
  }
}

/**
 * What a command may ask for through the server — the server allows exactly these. **Nothing here
 * changes anything**: sending, reacting, marking read and deleting never come this way, so no
 * guard can be walked around.
 */
export const READS = new Set<number>([
  Opcode.CHAT_HISTORY,
  Opcode.CHATS_LIST,
  Opcode.CONTACT_INFO,
  Opcode.FILE_DOWNLOAD,
  Opcode.VIDEO_PLAY,
  Opcode.MSG_GET_REACTIONS,
])
