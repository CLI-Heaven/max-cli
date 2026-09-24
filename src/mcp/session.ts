import { isCliError } from "@leemour/cli-core"
import { openProfileCache } from "../cache/index.js"
import type { CacheStore } from "../cache/store.js"
import type { MaxClient, MaxClientOptions } from "../client.js"
import type { CommandContext } from "../commands/context.js"

type Events = NonNullable<MaxClientOptions["events"]>

export interface SessionOptions {
  /** Close the connection after this long without a call. */
  idleMs?: number
  /** Log in again after this long, whatever the traffic: the chat list is what the login answered. */
  maxAgeMs?: number
  now?: () => number
}

/** The caller's mistake, not the connection's — nothing about the socket is in doubt after these. */
const HARMLESS = new Set(["validation_error", "not_found", "permission_error", "confirmation_required", "rate_limited"])

interface Held {
  client: MaxClient
  cache: CacheStore | undefined
  openedAt: number
}

/**
 * **One connection for the whole agent session, and never for long** (`NEED-152`).
 *
 * The CLI logs in once per command. Here the process outlives the call, so the connection is kept
 * between calls — and dropped after `idleMs` of quiet, after `maxAgeMs` whatever the traffic, and
 * after any failure that may have been the connection's. The age limit is there because a login
 * answers the chat list and the profile once; without it an agent that keeps talking would read a
 * snapshot that never moves.
 *
 * Calls run **one at a time**. A client may send read-only calls in parallel, and one socket with
 * one `seq` space is not the place to find out whether MAX minds.
 */
export class MaxSession {
  readonly #context: CommandContext
  readonly #idleMs: number
  readonly #maxAgeMs: number
  readonly #now: () => number
  #held: Held | undefined
  #idle: NodeJS.Timeout | undefined
  #queue: Promise<unknown> = Promise.resolve()
  #events: Events = () => {}
  #closed = false

  constructor(context: CommandContext, { idleMs = 120_000, maxAgeMs = 300_000, now = Date.now }: SessionOptions = {}) {
    this.#context = context
    this.#idleMs = idleMs
    this.#maxAgeMs = maxAgeMs
    this.#now = now
  }

  use<T>(name: string, body: (client: MaxClient) => Promise<T>): Promise<T> {
    const turn = this.#queue.then(() => this.#call(name, body))
    this.#queue = turn.catch(() => {})
    return turn
  }

  async close(): Promise<void> {
    this.#closed = true
    await this.#queue
    await this.#release()
  }

  async #call<T>(name: string, body: (client: MaxClient) => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("the MCP server is shutting down")
    clearTimeout(this.#idle)

    try {
      return await this.#context.run(name, async (events) => {
        this.#events = events ?? (() => {})
        return body(await this.#hold())
      })
    } catch (error) {
      if (!(isCliError(error) && HARMLESS.has(error.code))) await this.#release()
      throw error
    } finally {
      this.#events = () => {}
      if (this.#held) {
        this.#idle = setTimeout(() => void this.#release(), this.#idleMs)
        this.#idle.unref()
      }
    }
  }

  async #hold(): Promise<MaxClient> {
    if (this.#held && this.#now() - this.#held.openedAt >= this.#maxAgeMs) await this.#release()
    if (this.#held) return this.#held.client

    const { settings, renderer, createClient } = this.#context
    const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })
    const client = createClient({ events: (event) => this.#events(event), ...(cache ? { cache } : {}) })
    this.#held = { client, cache, openedAt: this.#now() }
    return client
  }

  async #release(): Promise<void> {
    clearTimeout(this.#idle)
    const held = this.#held
    this.#held = undefined
    if (!held) return
    try {
      await held.client.close()
    } finally {
      held.cache?.close()
    }
  }
}
