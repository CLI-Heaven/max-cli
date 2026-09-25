import { connect, type Socket } from "node:net"
import { CliError, errorCodes } from "@leemour/cli-core"
import { Opcode } from "../generated/opcodes.generated.js"
import { OPERATIONS } from "../generated/operations.generated.js"
import { Connection, ProtocolError, type Wire, type WireEvent } from "../protocol/connection.js"
import { asId, type Payload } from "../protocol/frame.js"
import type { SessionStore } from "../session/store.js"
import type { Operation } from "../spec/define.js"
import { fromLine, lineReader, toLine } from "./lines.js"

interface Pending {
  resolve: (answer: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * **A command's connection: `max serve`'s, shared** (`MAX-35`, `NEED-229`).
 *
 * One connection to MAX per profile, whoever asks — CLI commands, `max mcp`, `max watch`. INIT
 * and LOGIN are answered by the server's own login; **every other request goes over its
 * connection, sends included**. The server runs the send guards on every write and journals it;
 * the command's client checks too, so a refusal comes before an upload, and journals only that.
 *
 * No server answering: `ensure` starts one and waits for it. A connection of the command's own
 * is opened only when there is no `ensure` (the owner said `serve: false`) and no server, or for
 * a token being tried out (`max session start`), which is by definition not the server's.
 */
export class ServerConnection implements Wire {
  readonly #path: string
  readonly #store: SessionStore
  readonly #timeoutMs: number
  readonly #direct: () => Connection
  readonly #ensure: (() => Promise<boolean>) | undefined
  readonly #pending = new Map<number, Pending>()
  #socket: Socket | undefined
  #id = 0
  #login: Payload | undefined
  /** What the client sent as INIT; a fallback at LOGIN has to send it first, or MAX refuses. */
  #init: Payload | undefined
  #own: Connection | undefined

  constructor({
    path,
    store,
    timeoutMs = 30_000,
    direct,
    ensure,
  }: {
    path: string
    store: SessionStore
    timeoutMs?: number
    direct?: () => Connection
    /** Starts a server when none answers and waits for it; `false` if it did not come up. */
    ensure?: () => Promise<boolean>
  }) {
    this.#ensure = ensure
    this.#path = path
    this.#store = store
    this.#timeoutMs = timeoutMs
    this.#direct = direct ?? (() => new Connection({ timeoutMs }))
  }

  async open(): Promise<void> {}

  /** Whether the server is the one answering — and so the one writing the send journal. */
  get journals(): boolean {
    return this.#login !== undefined && this.#own === undefined
  }

  async invoke(opcode: number, payload: Payload = {}, watch?: (event: WireEvent) => void): Promise<Payload> {
    if (this.#own) return this.#own.invoke(opcode, payload, watch)

    if (opcode === Opcode.SESSION_INIT) {
      this.#init = payload
      this.#login = await this.#askServer({ login: true })
      return this.#login ? {} : this.#fallBack(opcode, payload, watch)
    }
    if (opcode === Opcode.LOGIN) {
      // A token being tried out (`max session start`) is not the one the server logged in with, and
      // a server still logged in as the account this profile had before is not this profile's.
      if (!this.#login || payload.token !== this.#store.readToken() || !this.#sameAccount(this.#login)) {
        return this.#fallBack(opcode, payload, watch)
      }
      return this.#login
    }

    watch?.({ phase: "sent", seq: this.#id + 1, opcode, bytes: 0 })
    const answer = await this.#ask({ opcode, payload })
    watch?.({ phase: "received", seq: this.#id, opcode, bytes: 0 })
    return answer
  }

  /** The server's answer, starting one if `ensure` may; `undefined` when there is none to be had. */
  async #askServer(request: Record<string, unknown>): Promise<Payload | undefined> {
    try {
      return await this.#ask(request)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ECONNREFUSED" && code !== "ENOENT") throw error
      if (!this.#ensure || !(await this.#ensure())) {
        if (this.#ensure) {
          throw new CliError(
            "network_error",
            "`max serve` did not start, and this profile shares one connection (`serve: true`) — " +
              "its log is beside the profile's state; `--no-serve` runs this command on its own",
          )
        }
        return undefined
      }
      return this.#ask(request)
    }
  }

  #sameAccount(login: Payload): boolean {
    const profile = login.profile as { contact?: { id?: unknown } } | undefined
    const viewerId = this.#store.readState().viewerId
    return viewerId === undefined || asId(profile?.contact?.id) === viewerId
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

  /** Before anything was sent: the command runs on its own connection, as with no server at all. */
  async #fallBack(opcode: number, payload: Payload, watch?: (event: WireEvent) => void): Promise<Payload> {
    this.#socket?.destroy()
    this.#socket = undefined
    this.#own = this.#direct()
    await this.#own.open()
    if (opcode === Opcode.LOGIN && this.#init) await this.#own.invoke(Opcode.SESSION_INIT, this.#init)
    return this.#own.invoke(opcode, payload, watch)
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

    const error = answer.error as
      | { code?: string; message?: string; payload?: Payload; details?: Record<string, unknown>; guard?: boolean }
      | undefined
    // The server's send guard: the same refusal, and so the same exit code, as the command's own.
    if (error?.guard === true) {
      const code = errorCodes.find((known) => known === error.code) ?? "permission_error"
      throw new CliError(code, error.message ?? "the server's send guard refused it", error.details)
    }
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
 * The operation the server passes on for this opcode, or `undefined` for one it does not: logging
 * in is the server's own business, a login by QR or SMS is `max session start` on a connection of
 * its own, and a reserved number is never sent at all.
 */
export const forwardedOperation = (opcode: number): Operation | undefined =>
  Object.values(OPERATIONS).find(
    (operation) =>
      operation.opcode === opcode && !operation.name.startsWith("session.") && !operation.name.startsWith("login."),
  )

/**
 * Asks a running server to stop. `"refused"` is a server started by hand, which only Ctrl-C
 * stops; `"none"` is nobody listening.
 */
export const stopServer = (path: string, { force = false } = {}): Promise<"stopped" | "refused" | "none"> =>
  new Promise((resolve) => {
    const socket = connect(path)
    let answer: "stopped" | "refused" | "none" = "none"
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(answer)
    }, 2000)
    // `force` is a person's own `max serve --stop`, which a server started by hand obeys too.
    socket.once("connect", () => socket.write(toLine({ id: 1, stop: true, ...(force ? { force } : {}) })))
    socket.on(
      "data",
      lineReader((line) => {
        answer = fromLine(line).stopped === true ? "stopped" : "refused"
      }),
    )
    socket.once("error", () => {
      clearTimeout(timer)
      resolve("none")
    })
    // After the answer, the server closes its end: stopped, it is gone once this fires.
    socket.once("close", () => {
      clearTimeout(timer)
      resolve(answer)
    })
  })

/** What a running server says about itself, or `undefined` when nobody answers. */
export const serverStatus = (path: string): Promise<Record<string, unknown> | undefined> =>
  new Promise((resolve) => {
    const socket = connect(path)
    const done = (status: Record<string, unknown> | undefined) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(status)
    }
    const timer = setTimeout(() => done(undefined), 2000)
    socket.once("connect", () => socket.write(toLine({ status: true })))
    socket.on(
      "data",
      lineReader((line) => done(fromLine(line))),
    )
    socket.once("error", () => done(undefined))
  })
