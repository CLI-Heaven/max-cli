import { CliError } from "@cli-heaven/cli-core"
import { namesFrom, toChat, toMessage, toProfile } from "./domain/map.js"
import type { Chat, Id, Message, Profile } from "./domain/models.js"
import { Connection, ProtocolError } from "./protocol/connection.js"
import type { Payload } from "./protocol/frame.js"
import { Opcode, startSession } from "./protocol/session.js"
import type { SessionStore } from "./session/store.js"

export interface MaxClientOptions {
  store: SessionStore
  timeoutMs?: number
  /** Injected by tests; defaults to a real WebSocket connection. */
  connection?: Connection
}

/**
 * **The only thing above this line that knows MAX exists.** Commands speak the domain model; the
 * library, the opcodes and the frames stop here, so a different transport underneath changes this
 * file and nothing else (REQUIREMENTS §25).
 *
 * One instance is one connection. `open` then `close`, always in a `finally`.
 */
export class MaxClient {
  readonly #store: SessionStore
  readonly #connection: Connection
  #login: Payload | undefined
  #previousCid = 0

  constructor({ store, timeoutMs, connection }: MaxClientOptions) {
    this.#store = store
    this.#connection = connection ?? new Connection(timeoutMs === undefined ? {} : { timeoutMs })
  }

  /**
   * Opens the connection and logs in with the stored token.
   *
   * The login response carries the profile, the chats, the contacts and recent messages, so most
   * commands need no further request — measured against MAX on 2026-09-19.
   */
  async connect(): Promise<void> {
    const token = this.#store.readToken()
    if (!token) {
      throw new CliError("authentication_error", `no session for profile "${this.#store.profile}" — run \`max login\``)
    }

    const state = this.#store.readState()

    try {
      await this.#connection.open()
      this.#login = await startSession(this.#connection, { token, deviceId: state.deviceId })
    } catch (error) {
      throw asCliError(error)
    }

    const viewerId = toProfile(record(this.#login.profile) ?? {}).id
    this.#store.writeState({
      ...state,
      ...(viewerId ? { viewerId } : {}),
      logins: state.logins + 1,
      lastLoginAt: new Date().toISOString(),
    })
  }

  me(): Profile {
    return toProfile(record(this.#session().profile) ?? {})
  }

  /** Chats come with the login; a limit trims, it does not fetch more. */
  listChats(limit?: number): Chat[] {
    const chats = asArray(this.#session().chats).map((raw) => toChat(raw))
    return limit === undefined ? chats : chats.slice(0, limit)
  }

  async listMessages(chatId: Id, limit = 20): Promise<Message[]> {
    const session = this.#session()

    // `interactive: false` and no CHAT_MARK: reading history must not mark anything read (§19).
    const answer = await this.#invoke(Opcode.CHAT_HISTORY, {
      chatId: Number(chatId),
      from: Date.now(),
      forward: 0,
      backward: limit,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
      interactive: false,
    })

    const lookup = { names: namesFrom(session.contacts), ...viewer(this.#store) }
    return asArray(answer.messages).map((raw) => toMessage(raw, chatId, lookup))
  }

  /**
   * Sends one message, and **never retries it**.
   *
   * MAX carries a client-generated `cid` on every outgoing message, and the protocol
   * documentation calls it a deduplication identifier — but that is reverse-engineered
   * documentation, and nobody has measured what the server does with a repeated one. Until
   * somebody has, a send whose outcome we did not see is reported as exactly that: `outcome_unknown`,
   * never as failed and never as sent. A duplicate message is worse than an honest "I do not know"
   * (REQUIREMENTS §17).
   */
  async sendMessage(chatId: Id, text: string, options: { cid?: number; notify?: boolean } = {}): Promise<Message> {
    const session = this.#session()
    const cid = options.cid ?? this.#nextCid()

    let answer: Payload
    try {
      answer = await this.#connection.invoke(Opcode.MSG_SEND, {
        chatId: Number(chatId),
        message: { text, cid, elements: [], attaches: [] },
        notify: options.notify ?? true,
      })
    } catch (error) {
      const failure = asCliError(error)
      // The request left and no answer came back: MAX may well have delivered it.
      if (failure.code === "timeout" || failure.code === "network_error") {
        throw new CliError(
          "outcome_unknown",
          `the message may or may not have been sent (${failure.message}) — check the chat before sending it again`,
          { cid },
        )
      }
      throw failure
    }

    const sent = record(answer.message) ?? answer
    return toMessage(sent, chatId, { names: namesFrom(session.contacts), ...viewer(this.#store) })
  }

  async close(): Promise<void> {
    await this.#connection.close()
  }

  /**
   * A client id that never repeats within a process.
   *
   * `Date.now()` alone is not enough: two sends in the same millisecond get the same number, and if
   * MAX really does deduplicate by `cid` the second message vanishes with no error anywhere. Caught
   * by a test, not by a lost message. Across processes this is still millisecond-grained, which is
   * safe while one invocation sends one message.
   */
  #nextCid(): number {
    const now = Date.now()
    this.#previousCid = now > this.#previousCid ? now : this.#previousCid + 1
    return this.#previousCid
  }

  #session(): Payload {
    if (!this.#login) throw new CliError("configuration_error", "connect() was never called")
    return this.#login
  }

  async #invoke(opcode: number, payload: Payload): Promise<Payload> {
    try {
      return await this.#connection.invoke(opcode, payload)
    } catch (error) {
      throw asCliError(error)
    }
  }
}

const viewer = (store: SessionStore) => {
  const viewerId = store.readState().viewerId
  return viewerId === undefined ? {} : { viewerId }
}

const record = (value: unknown): Payload | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : undefined

const asArray = (value: unknown): Payload[] =>
  Array.isArray(value) ? value.filter((item): item is Payload => record(item) !== undefined) : []

/**
 * MAX's own words become our error codes.
 *
 * A refusal naming the token is an authentication problem the user can fix by logging in again;
 * everything else from the far end is `provider_error`, and a connection that died is a network
 * one. Nothing here retries: whether an operation may be repeated is the caller's question.
 */
const asCliError = (error: unknown): CliError => {
  if (error instanceof CliError) return error

  if (error instanceof ProtocolError) {
    const text = error.message.toLowerCase()
    if (text.includes("token") || text.includes("auth")) {
      return new CliError("authentication_error", `${error.message} — the session may have expired; run \`max login\``)
    }
    return new CliError("provider_error", error.message, { operation: String(error.opcode) })
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("did not answer")) return new CliError("timeout", message)
  return new CliError("network_error", message)
}
