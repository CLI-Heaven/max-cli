import { chmodSync, mkdirSync, rmSync } from "node:fs"
import { connect, createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"
import { CliError } from "@leemour/cli-core"
import type { CacheStore } from "../cache/store.js"
import { MaxClient } from "../client.js"
import type { MessageHit } from "../domain/models.js"
import { Connection, type ConnectionOptions } from "../protocol/connection.js"
import type { SessionStore } from "../session/store.js"

export type ServerEvent =
  | { event: "message"; message: MessageHit }
  | { event: "status"; connected: boolean; at: string }

export interface MaxServerOptions {
  store: SessionStore
  cache?: CacheStore
  timeoutMs?: number
  /** One line for a person, on stderr. */
  note: (line: string) => void
  /** Tests hand in a scripted MAX; the hooks must reach it. */
  connection?: (hooks: Pick<ConnectionOptions, "onEvent" | "onClose">) => Connection
  pingEveryMs?: number
  retryAfterMs?: (attempt: number) => number
}

/** The web client's keep-alive interval (web.max.ru bundle, 2026-09-24). A different one is a fingerprint. */
const PING_EVERY_MS = 30_000

/**
 * **One logged-in connection per profile, kept open** (`MAX-16`), and a Unix socket beside the
 * profile's state for local readers.
 *
 * It reopens REQUIREMENTS §3 and §18 on purpose and only here: every other command stays one-shot.
 * What it does on the wire copies web.max.ru — a ping every 30 s, MAX's pings answered, each new
 * message acknowledged (`Connection` with `live`). It never marks anything read and never sends.
 *
 * The socket answers `{"subscribe": true}` with a stream of `ServerEvent` lines, and
 * `{"status": true}` with one. It forwards nothing to MAX: a request through it would pass the
 * send guards by, so reusing the connection for commands waits until it can go through them.
 */
export class MaxServer {
  readonly #options: MaxServerOptions
  readonly #subscribers = new Set<Socket>()
  #listener: Server | undefined
  #client: MaxClient | undefined
  #ping: ReturnType<typeof setInterval> | undefined
  #retry: ReturnType<typeof setTimeout> | undefined
  #attempt = 0
  #stopped = false
  #finish: ((error?: Error) => void) | undefined
  /** Settles when the server stops — cleanly, or with the error that stopped it. */
  readonly done: Promise<void>

  constructor(options: MaxServerOptions) {
    this.#options = options
    this.done = new Promise((resolve, reject) => {
      this.#finish = (error) => (error ? reject(error) : resolve())
    })
  }

  get connected(): boolean {
    return this.#client !== undefined
  }

  /** Logs in first: a token that does not work should fail here, before anything listens. */
  async start(): Promise<void> {
    await this.#connect()
    await this.#listen()
  }

  async stop(error?: Error): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    clearInterval(this.#ping)
    clearTimeout(this.#retry)
    for (const socket of this.#subscribers) socket.destroy()
    this.#subscribers.clear()
    await new Promise<void>((resolve) => (this.#listener ? this.#listener.close(() => resolve()) : resolve()))
    rmSync(this.#options.store.socketPath(), { force: true })
    await this.#client?.close()
    this.#client = undefined
    this.#finish?.(error)
  }

  async #connect(): Promise<void> {
    const { store, cache, timeoutMs } = this.#options
    const connection = (
      this.#options.connection ??
      ((hooks) => new Connection({ ...hooks, live: true, ...(timeoutMs ? { timeoutMs } : {}) }))
    )({
      onEvent: (frame) => this.#pushed(frame.opcode, frame.payload ?? {}),
      onClose: (error) => this.#lost(error),
    })
    const client = new MaxClient({ store, connection, warn: this.#options.note, ...(cache ? { cache } : {}) })
    try {
      await client.connect()
    } catch (error) {
      // A socket left open after a refused login keeps the process alive after it said it failed.
      await client.close()
      throw error
    }

    this.#client = client
    this.#attempt = 0
    this.#broadcast({ event: "status", connected: true, at: new Date().toISOString() })
    this.#ping = setInterval(() => {
      client.live.ping().catch(() => {})
    }, this.#options.pingEveryMs ?? PING_EVERY_MS)
  }

  #pushed(opcode: number, payload: Record<string, unknown>): void {
    const client = this.#client
    if (!client) return
    client.live
      .message(opcode, payload)
      .then((message) => message && this.#broadcast({ event: "message", message }))
      .catch((error: Error) => this.#options.note(`a pushed message could not be read: ${error.message}`))
  }

  #lost(error: Error): void {
    clearInterval(this.#ping)
    const client = this.#client
    this.#client = undefined
    client?.close().catch(() => {})
    if (this.#stopped) return

    this.#broadcast({ event: "status", connected: false, at: new Date().toISOString() })
    this.#reconnectLater(error)
  }

  #reconnectLater(error: Error): void {
    const wait = (this.#options.retryAfterMs ?? backoff)(this.#attempt)
    this.#attempt += 1
    this.#options.note(`${error.message} — connecting again in ${Math.round(wait / 1000)}s`)
    this.#retry = setTimeout(() => {
      this.#connect().catch((failure: Error) => {
        // A token MAX no longer takes will not start working on the next attempt.
        if (failure instanceof CliError && failure.code === "authentication_error") this.stop(failure)
        else this.#reconnectLater(failure)
      })
    }, wait)
  }

  #broadcast(event: ServerEvent): void {
    const line = `${JSON.stringify(event)}\n`
    for (const socket of this.#subscribers) socket.write(line)
  }

  async #listen(): Promise<void> {
    const path = this.#options.store.socketPath()
    if (await answers(path)) {
      throw new CliError("validation_error", `a server is already running for profile "${this.#options.store.profile}"`)
    }
    // Nobody answers on it, so it is what a crashed server left behind.
    rmSync(path, { force: true })
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })

    const listener = createServer((socket) => this.#serve(socket))
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject)
      listener.listen(path, () => resolve())
    })
    chmodSync(path, 0o600)
    this.#listener = listener
  }

  #serve(socket: Socket): void {
    socket.on("error", () => this.#subscribers.delete(socket))
    socket.on("close", () => this.#subscribers.delete(socket))
    let buffered = ""
    socket.on("data", (data) => {
      buffered += String(data)
      let end = buffered.indexOf("\n")
      while (end >= 0) {
        this.#request(socket, buffered.slice(0, end))
        buffered = buffered.slice(end + 1)
        end = buffered.indexOf("\n")
      }
    })
  }

  #request(socket: Socket, line: string): void {
    let request: Record<string, unknown>
    try {
      request = JSON.parse(line) as Record<string, unknown>
    } catch {
      socket.write(`${JSON.stringify({ error: "one JSON object per line" })}\n`)
      return
    }
    const status = { event: "status", connected: this.connected, at: new Date().toISOString() }
    if (request.subscribe === true) {
      this.#subscribers.add(socket)
      socket.write(`${JSON.stringify(status)}\n`)
    } else if (request.status === true) {
      socket.write(`${JSON.stringify(status)}\n`)
    } else {
      socket.write(`${JSON.stringify({ error: "this server answers `subscribe` and `status` only" })}\n`)
    }
  }
}

/** 1 s, 2 s, 4 s … a minute at most — a server that hammers MAX after a drop looks like nothing MAX knows. */
const backoff = (attempt: number): number => Math.min(60_000, 1000 * 2 ** attempt)

/** Whether something is listening on the socket — a live server, not a leftover file. */
export const answers = (path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = connect(path)
    probe.once("connect", () => {
      probe.destroy()
      resolve(true)
    })
    probe.once("error", () => resolve(false))
  })
