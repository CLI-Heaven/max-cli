import { CliError } from "@cli-heaven/cli-core"
import { namesFrom, toChat, toContact, toMessage, toProfile } from "./domain/map.js"
import type { Chat, Contact, Id, Message, Profile } from "./domain/models.js"
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
  #people: Map<Id, Contact> | undefined

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

  /**
   * Chats come with the login; a limit trims rather than fetching more.
   *
   * **A one-to-one chat has no title of its own** — its name is the other person's, which MAX does
   * not put in the chat object. So the partner is looked up once, for every dialog at a time, and
   * the name is filled in. Without this, `max chats` shows a column of blanks for exactly the chats
   * a person recognises by name.
   */
  async listChats(limit?: number): Promise<Chat[]> {
    const raw = asArray(this.#session().chats)
    const people = await this.#peopleFor(raw)

    const chats = raw.map((chat) => {
      const mapped = toChat(chat)
      if (mapped.title !== null || mapped.kind !== "dialog") return mapped

      const partner = this.#partnerOf(chat)
      const name = partner === undefined ? null : (people.get(partner)?.name ?? null)
      return { ...mapped, title: name }
    })

    return limit === undefined ? chats : chats.slice(0, limit)
  }

  /** The people this account has a one-to-one chat with, named. */
  async listContacts(): Promise<Contact[]> {
    const people = await this.#peopleFor(asArray(this.#session().chats))
    return [...people.values()].filter((contact) => contact.id !== "")
  }

  /**
   * Turns what the person typed into a chat id.
   *
   * A number is taken as an id. Anything else is matched against chat titles, exactly first and
   * then as a fragment — and **an ambiguous name is an error, not a guess**: sending to the wrong
   * conversation is not undoable, so the caller is shown the candidates and asked to be specific.
   */
  async resolveChat(reference: string): Promise<Id> {
    if (/^-?\d+$/.test(reference.trim())) return reference.trim()

    const chats = await this.listChats()
    const wanted = reference.trim().toLowerCase()
    const titled = chats.filter((chat) => chat.title !== null)

    const exact = titled.filter((chat) => chat.title?.toLowerCase() === wanted)
    const matches = exact.length > 0 ? exact : titled.filter((chat) => chat.title?.toLowerCase().includes(wanted))

    if (matches.length === 1 && matches[0]) return matches[0].id
    if (matches.length === 0) throw new CliError("not_found", `no chat matches "${reference}"`)

    const names = matches.map((chat) => `${chat.title} (${chat.id})`).join(", ")
    throw new CliError("validation_error", `"${reference}" matches ${matches.length} chats: ${names}`)
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
   * Sends one message, retrying **only with the same `cid`**.
   *
   * §17 allows a send to be retried when the protocol has a verified deduplication handle. It has
   * one, measured against MAX on 2026-09-19: sending the same `cid` twice returned the same message
   * id and left **one** copy in the chat — and it held across two separate connections and logins,
   * which is the case a retry actually faces.
   *
   * So one retry, same `cid`, and nothing beyond that. What is still unmeasured is how long the
   * server remembers a `cid`; the two probes were seconds apart. If the retry also fails the answer
   * is `outcome_unknown` — never failed, never sent — and it names the `cid`, because
   * `max send --cid <n>` can then repeat the attempt without risking a second message.
   */
  async sendMessage(chatId: Id, text: string, options: { cid?: number; notify?: boolean } = {}): Promise<Message> {
    const session = this.#session()
    const cid = options.cid ?? this.#nextCid()

    const request = {
      chatId: Number(chatId),
      message: { text, cid, elements: [], attaches: [] },
      notify: options.notify ?? true,
    }

    let answer: Payload
    try {
      answer = await this.#connection.invoke(Opcode.MSG_SEND, request)
    } catch (error) {
      const failure = asCliError(error)
      if (failure.code !== "timeout" && failure.code !== "network_error") throw failure

      // No answer came back, so MAX may already have delivered it. Repeating the identical `cid`
      // is what makes asking again safe rather than reckless.
      try {
        answer = await this.#connection.invoke(Opcode.MSG_SEND, request)
      } catch {
        throw new CliError(
          "outcome_unknown",
          `the message may or may not have been sent (${failure.message}) — ` +
            `\`max send --cid ${cid}\` repeats the attempt without risking a second copy`,
          { cid },
        )
      }
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

  /**
   * Names for everyone in these chats, from the login response first and one request for the rest.
   *
   * One `CONTACT_INFO` for all the unknown ids rather than one per chat: a person with forty
   * dialogs should not cost forty round trips, and the login only carries a handful of contacts —
   * six of seventeen dialog partners, measured on a real account.
   */
  async #peopleFor(chats: Payload[]): Promise<Map<Id, Contact>> {
    if (this.#people) return this.#people

    const people = new Map<Id, Contact>()
    for (const raw of asArray(this.#session().contacts)) {
      const contact = toContact(raw)
      if (contact.id) people.set(contact.id, contact)
    }

    const missing = new Set<Id>()
    for (const chat of chats) {
      const partner = this.#partnerOf(chat)
      if (partner !== undefined && !people.has(partner)) missing.add(partner)
    }

    if (missing.size > 0) {
      const answer = await this.#invoke(Opcode.CONTACT_INFO, { contactIds: [...missing].map(Number) })
      for (const raw of asArray(answer.contacts)) {
        const contact = toContact(raw)
        if (contact.id) people.set(contact.id, contact)
      }
    }

    this.#people = people
    return people
  }

  /** The other party in a one-to-one chat, if there is exactly one. */
  #partnerOf(chat: Payload): Id | undefined {
    const participants = record(chat.participants)
    if (!participants) return undefined

    const viewerId = this.#store.readState().viewerId
    const others = Object.keys(participants).filter((id) => id !== viewerId)
    return others.length === 1 ? others[0] : undefined
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
