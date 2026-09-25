import { chmodSync, mkdirSync, rmSync } from "node:fs"
import { connect, createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"
import { CliError } from "@leemour/cli-core"
import type { CacheStore } from "../cache/store.js"
import { MaxClient, type MaxClientOptions } from "../client.js"
import type { MessageHit } from "../domain/models.js"
import { Opcode } from "../generated/opcodes.generated.js"
import { Connection, type ConnectionOptions, ProtocolError } from "../protocol/connection.js"
import type { SessionStore } from "../session/store.js"
import { VERSION } from "../version.js"
import { fromLine, lineReader, toLine } from "./lines.js"
import { forwarded, stopServer } from "./server-connection.js"

export type ServerEvent =
  | { event: "message"; message: MessageHit }
  | { event: "status"; connected: boolean; at: string; byHand?: boolean; pid?: number }

export interface MaxServerOptions {
  store: SessionStore
  cache?: CacheStore
  timeoutMs?: number
  /** One line for a person, on stderr. */
  note: (line: string) => void
  /** Tests hand in a scripted MAX; the hooks must reach it. */
  connection?: (hooks: Pick<ConnectionOptions, "onEvent" | "onClose">) => Connection
  pingEveryMs?: number
  /** The least time between two background logins after the snapshot went stale. */
  refreshEveryMs?: number
  retryAfterMs?: (attempt: number) => number
  /**
   * **A command started it**, not a person. Only such a server stops when asked over its socket;
   * one started by hand runs until Ctrl-C, whoever asks (the owner's rule, 2026-09-24).
   */
  startedByCommand?: boolean
  /**
   * Stop after this long with nobody using it — no request, no `max watch`. Absent, it runs until
   * stopped; a server started by a command gets one, or it would outlive every reason it had.
   */
  idleMs?: number
  /** One event per request, for `--trace` and the run log — pings included. */
  events?: MaxClientOptions["events"]
}

/** The web client's keep-alive interval (web.max.ru bundle, 2026-09-24). A different one is a fingerprint. */
const PING_EVERY_MS = 30_000

/** A message arrived — what MAX pushes, and what a send through this server is handed on as. */
const NEW_MESSAGE = 128

/** A login MAX counts; after one, the next background login waits at least this long. */
const REFRESH_EVERY_MS = 60_000

/**
 * **One logged-in connection per profile, kept open** (`MAX-16`), and a Unix socket beside the
 * profile's state for local readers.
 *
 * It reopens REQUIREMENTS §3 and §18 on purpose and only here: every other command stays one-shot.
 * What it does on the wire copies web.max.ru — a ping every 30 s, MAX's pings answered, each new
 * message acknowledged (`Connection` with `live`). It never marks anything read and never sends.
 *
 * The socket answers `{"subscribe": true}` with a stream of `ServerEvent` lines and
 * `{"status": true}` with one. For a command reusing the connection (`ServerConnection`) it answers
 * `{"id", "login": true}` with the login it holds, and `{"id", "opcode", "payload"}` by passing the
 * request to MAX — **reads only** (`NEED-185`). Anything that writes goes on the command's own
 * connection, through the send guards, which live in the client and nowhere else.
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
  /** Every client on the socket — a command, `max mcp`, `max watch`. Idle means none at all. */
  readonly #open = new Set<Socket>()
  /** Message ids already handed to watchers, newest last. */
  readonly #seen = new Set<string>()
  /** Settles when a connection is up; replaced while the server reconnects. */
  #up: Promise<void>
  #markUp: () => void = () => {}
  #refresh: ReturnType<typeof setTimeout> | undefined
  #lastRefresh = 0
  #lastUse = Date.now()
  readonly #startedAt = new Date().toISOString()
  #idle: ReturnType<typeof setInterval> | undefined
  #finish: ((error?: Error) => void) | undefined
  /** Settles when the server stops — cleanly, or with the error that stopped it. */
  readonly done: Promise<void>

  constructor(options: MaxServerOptions) {
    this.#options = options
    this.#up = new Promise((resolve) => {
      this.#markUp = resolve
    })
    this.done = new Promise((resolve, reject) => {
      this.#finish = (error) => (error ? reject(error) : resolve())
    })
  }

  get connected(): boolean {
    return this.#client !== undefined
  }

  /** Logs in first: a token that does not work should fail here, before anything listens. */
  async start(): Promise<void> {
    // The socket first: whoever binds it is the profile's one server, and a second one learns it
    // before it has logged in — not after, with a login MAX has already counted.
    try {
      await this.#listen()
      await this.#connect()
    } catch (error) {
      await this.stop()
      throw error
    } finally {
      rmSync(startingPath(this.#options.store), { force: true })
    }
    const { idleMs } = this.#options
    if (idleMs !== undefined) {
      this.#idle = setInterval(
        () => {
          if (this.#open.size === 0 && Date.now() - this.#lastUse >= idleMs) {
            this.#options.note(`nobody has used it for ${Math.round(idleMs / 60_000)} min — stopping`)
            void this.stop()
          }
        },
        Math.min(idleMs, 30_000),
      )
    }
  }

  async stop(error?: Error): Promise<void> {
    if (this.#stopped) return
    this.#stopped = true
    // Anyone still waiting for a connection gets "not connected" rather than waiting forever.
    this.#markUp()
    clearInterval(this.#ping)
    clearTimeout(this.#retry)
    clearTimeout(this.#refresh)
    clearInterval(this.#idle)
    for (const socket of this.#open) socket.destroy()
    this.#subscribers.clear()
    // Only the server that bound the socket removes it: one refused as "already running" would
    // otherwise delete the running server's socket and let a third start beside it.
    if (this.#listener) {
      await new Promise<void>((resolve) => this.#listener?.close(() => resolve()))
      rmSync(this.#options.store.socketPath(), { force: true })
    }
    await this.#client?.close()
    this.#client = undefined
    this.#finish?.(error)
  }

  /**
   * Logs in on a new connection and, once that worked, makes it the server's — closing the one it
   * replaces, if any. Pushes that arrive before the login finishes are held and replayed, not
   * dropped: `Connection` has already acknowledged them, so MAX will not send them again.
   */
  async #connect(): Promise<void> {
    const { store, cache, timeoutMs, events } = this.#options
    let mine: MaxClient | undefined
    const early: [number, Record<string, unknown>][] = []
    const connection = (
      this.#options.connection ??
      ((hooks) => new Connection({ ...hooks, live: true, ...(timeoutMs ? { timeoutMs } : {}) }))
    )({
      onEvent: (frame) => {
        if (mine) this.#pushed(mine, frame.opcode, frame.payload ?? {})
        else early.push([frame.opcode, frame.payload ?? {}])
      },
      onClose: (error) => {
        if (mine && mine === this.#client) this.#lost(error)
      },
    })
    const client = new MaxClient({
      store,
      connection,
      fullLogin: true,
      warn: this.#options.note,
      ...(cache ? { cache } : {}),
      ...(events ? { events } : {}),
    })
    try {
      await client.connect()
    } catch (error) {
      // A socket left open after a refused login keeps the process alive after it said it failed.
      await client.close()
      throw error
    }

    const replaced = this.#client
    mine = client
    this.#client = client
    this.#markUp()
    this.#attempt = 0
    this.#lastRefresh = Date.now()
    clearInterval(this.#ping)
    this.#ping = setInterval(() => {
      client.live.ping().catch(() => {})
    }, this.#options.pingEveryMs ?? PING_EVERY_MS)
    if (replaced) await replaced.close().catch(() => {})
    else this.#broadcast({ event: "status", connected: true, at: new Date().toISOString() })
    for (const [opcode, payload] of early) this.#pushed(client, opcode, payload)
  }

  #pushed(client: MaxClient, opcode: number, payload: Record<string, unknown>): void {
    if (!client.live.patch(opcode, payload)) this.#goneStale()
    client.live
      .message(opcode, payload)
      .then((message) => message && this.#broadcast({ event: "message", message }))
      .catch((error: Error) => this.#options.note(`a pushed message could not be read: ${error.message}`))
  }

  /**
   * The login can no longer be handed out. Rather than wait for a drop that may be hours away, log
   * in again in the background — at most once a minute, since each is a login MAX counts.
   */
  #goneStale(): void {
    if (this.#refresh || this.#stopped) return
    const every = this.#options.refreshEveryMs ?? REFRESH_EVERY_MS
    const wait = Math.max(0, this.#lastRefresh + every - Date.now())
    this.#refresh = setTimeout(() => {
      this.#connect()
        .catch((error: Error) => this.#options.note(`could not log in again: ${error.message}`))
        .finally(() => {
          this.#refresh = undefined
        })
    }, wait)
  }

  #lost(error: Error): void {
    clearInterval(this.#ping)
    const client = this.#client
    this.#client = undefined
    this.#up = new Promise((resolve) => {
      this.#markUp = resolve
    })
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
    if (event.event === "message") {
      // A retried send answers with the same message, and MAX repeats pushes after a hiccup.
      if (this.#seen.has(event.message.id)) return
      this.#seen.add(event.message.id)
      if (this.#seen.size > 500) this.#seen.delete(this.#seen.values().next().value as string)
    }
    const line = toLine(event)
    for (const socket of this.#subscribers) socket.write(line)
  }

  async #listen(): Promise<void> {
    const path = this.#options.store.socketPath()
    // A server a command started gives way to one started by hand; one started by hand does not.
    if ((await answers(path)) && !(!this.#options.startedByCommand && (await stopServer(path)) === "stopped")) {
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
    this.#open.add(socket)
    socket.on("error", () => this.#subscribers.delete(socket))
    socket.on("close", () => {
      this.#subscribers.delete(socket)
      this.#open.delete(socket)
      this.#lastUse = Date.now()
    })
    socket.on(
      "data",
      lineReader((line) => {
        this.#request(socket, line).catch(() => socket.destroy())
      }),
    )
  }

  async #request(socket: Socket, line: string): Promise<void> {
    let request: Record<string, unknown>
    try {
      request = fromLine(line)
    } catch {
      socket.write(toLine({ error: { code: "bad_request", message: "one JSON object per line" } }))
      return
    }
    const status = {
      event: "status",
      connected: this.connected,
      at: new Date().toISOString(),
      byHand: !this.#options.startedByCommand,
      pid: process.pid,
      version: VERSION,
      startedAt: this.#startedAt,
    }
    const { id } = request
    this.#lastUse = Date.now()

    if (request.subscribe === true) {
      this.#subscribers.add(socket)
      socket.write(toLine(status))
    } else if (request.status === true) {
      socket.write(toLine(status))
    } else if (request.stop === true) {
      // Only the owner can reach this socket (mode 600). `max session end` asks, so a forgotten
      // session is not kept alive by a server a command started — one started by hand stays.
      if (!this.#options.startedByCommand && request.force !== true) {
        socket.end(toLine({ id, stopped: false, reason: "started by hand; Ctrl-C, or `max serve --stop`" }))
        return
      }
      socket.end(toLine({ id, stopped: true }))
      await this.stop()
    } else if (request.login === true) {
      // A request that arrives while the server logs in, or logs in again, waits for it: the
      // command's own timeout is what gives up, not this. A login a deletion made stale is still
      // handed out — only a deleted last message can be wrong in it — while a fresh one is fetched.
      await this.#up
      const client = this.#client
      socket.write(
        toLine(
          client
            ? { id, payload: client.live.snapshot() }
            : { id, error: { code: "unavailable", message: "not connected" } },
        ),
      )
    } else if (typeof request.opcode === "number") {
      socket.write(toLine({ id, ...(await this.#forward(request.opcode, request.payload)) }))
    } else {
      socket.write(toLine({ id, error: { code: "bad_request", message: "subscribe, status, login or an opcode" } }))
    }
  }

  async #forward(opcode: number, payload: unknown): Promise<Record<string, unknown>> {
    await this.#up
    const client = this.#client
    if (!forwarded(opcode)) {
      return {
        error: { code: "not_allowed", message: `opcode ${opcode} is a login; the server does its own` },
      }
    }
    if (!client) return { error: { code: "unavailable", message: "not connected" } }
    try {
      const request = (payload ?? {}) as Record<string, unknown>
      const answer = await client.live.forward(opcode, request)
      // MAX does not push a message back to the connection that sent it, and every send now comes
      // through this one — so `max watch` would never see what `max` itself sent. The answer
      // carries the message; hand it on as if it had been pushed. A scheduled one is not sent yet.
      const scheduled = (request.message as { delayedAttributes?: unknown } | undefined)?.delayedAttributes
      if (opcode === Opcode.MSG_SEND && answer.message && !scheduled) {
        this.#pushed(client, NEW_MESSAGE, { chatId: request.chatId, message: answer.message })
      }
      // Nor does it push our own deletion back; the chat's last message may be the one deleted.
      if (opcode === Opcode.MSG_DELETE) this.#goneStale()
      return { payload: answer }
    } catch (error) {
      if (error instanceof ProtocolError) {
        return { error: { code: "refused", message: error.message, payload: error.payload } }
      }
      return { error: { code: "unavailable", message: error instanceof Error ? error.message : String(error) } }
    }
  }
}

/** 1 s, 2 s, 4 s … a minute at most — a server that hammers MAX after a drop looks like nothing MAX knows. */
const backoff = (attempt: number): number => Math.min(60_000, 1000 * 2 ** attempt)

/** Present while a server is being started in the background, so two commands do not start two. */
export const startingPath = (store: SessionStore): string => `${store.socketPath()}.starting`

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
