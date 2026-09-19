import { CliError } from "@cli-heaven/cli-core"
import type { CacheStore } from "./cache/store.js"
import { namesFrom, toChat, toContact, toMessage, toProfile } from "./domain/map.js"
import type { Chat, Contact, Id, Message, Profile } from "./domain/models.js"
import { type Invoke, wireClient } from "./generated/client.generated.js"
import { Connection, ProtocolError } from "./protocol/connection.js"
import type { Payload } from "./protocol/frame.js"
import { startSession } from "./session/handshake.js"
import type { SessionStore } from "./session/store.js"
import { buildRequest, checkResponse, type Operation, type RequestOf } from "./spec/index.js"

export interface MaxClientOptions {
  store: SessionStore
  timeoutMs?: number
  /** Injected by tests; defaults to a real WebSocket connection. */
  connection?: Connection
  /**
   * Where a protocol note goes. Never stdout: in machine mode that stream carries one JSON value
   * and nothing else.
   */
  warn?: (message: string) => void
  /** Where reads are recorded. It is a record, not a shortcut — see `offline`. */
  cache?: CacheStore
  /**
   * Answer from what was recorded and **never connect**.
   *
   * Off by default, and deliberately: `LOGIN` already returns the chats, the contacts and recent
   * messages, so once a command connects at all those are fresh for free. Serving them from disk
   * instead buys only the right to skip connecting — which is the same act as deciding not to find
   * out what changed. For a messenger that is backwards (§3.4z of the cache plan).
   */
  offline?: boolean
}

/**
 * **The only thing above this line that knows MAX exists.** Commands speak the domain model; the
 * opcodes and the frames stop here, so a different transport underneath changes this file and
 * nothing else (REQUIREMENTS §25).
 *
 * The methods are grouped by subject — `client.chats.list()`, `client.messages.send()` — which is
 * the shape §8 sketched. **There is only this door.** The generated per-operation wrappers sit
 * underneath and stay internal: they return raw MAX payloads, without the resend rule, the name
 * filling or the id conversion that make this safe to point at a real account (`NEED-34`).
 *
 * One instance is one connection. `open` then `close`, always in a `finally`.
 */
export class MaxClient {
  readonly #store: SessionStore
  readonly #connection: Connection
  readonly #warn: (message: string) => void
  readonly #cache: CacheStore | undefined
  readonly #offline: boolean
  readonly #wire = wireClient(((operation, request) => this.#send(operation, request)) as Invoke)
  #login: Payload | undefined
  #previousCid = 0
  #people: Map<Id, Contact> | undefined

  constructor({ store, timeoutMs, connection, warn, cache, offline = false }: MaxClientOptions) {
    this.#store = store
    this.#connection = connection ?? new Connection(timeoutMs === undefined ? {} : { timeoutMs })
    this.#warn = warn ?? ((message) => process.stderr.write(`${message}\n`))
    this.#cache = cache
    this.#offline = offline
  }

  readonly account = {
    me: (): Profile => toProfile(record(this.#session().profile) ?? {}),
  }

  readonly chats = {
    /**
     * Chats come with the login; a limit trims rather than fetching more.
     *
     * **A one-to-one chat has no title of its own** — its name is the other person's, which MAX
     * does not put in the chat object. So the partner is looked up once, for every dialog at a
     * time, and the name is filled in. Without this, `max chats` shows a column of blanks for
     * exactly the chats a person recognises by name.
     */
    list: async (limit?: number): Promise<Chat[]> => {
      if (this.#offline) {
        const cached = this.#recorded(this.#cache?.chats.read(ANY_AGE), "chats")
        return limit === undefined ? cached : cached.slice(0, limit)
      }

      await this.#connectOnce()
      const raw = asArray(this.#session().chats)
      const people = await this.#peopleFor(raw)

      const chats = raw.map((chat) => {
        const mapped = toChat(chat)
        if (mapped.title !== null || mapped.kind !== "dialog") return mapped

        const partner = this.#partnerOf(chat)
        const name = partner === undefined ? null : (people.get(partner)?.name ?? null)
        return { ...mapped, title: name }
      })

      this.#cache?.chats.write(chats)
      return limit === undefined ? chats : chats.slice(0, limit)
    },

    /**
     * Turns what the person typed into a chat id.
     *
     * A number is taken as an id. Anything else is matched against chat titles, exactly first and
     * then as a fragment — and **an ambiguous name is an error, not a guess**: sending to the wrong
     * conversation is not undoable, so the caller is shown the candidates and asked to be specific.
     */
    resolve: async (reference: string): Promise<Id> => {
      if (/^-?\d+$/.test(reference.trim())) return reference.trim()

      const chats = await this.chats.list()
      const wanted = reference.trim().toLowerCase()
      const titled = chats.filter((chat) => chat.title !== null)

      const exact = titled.filter((chat) => chat.title?.toLowerCase() === wanted)
      const matches = exact.length > 0 ? exact : titled.filter((chat) => chat.title?.toLowerCase().includes(wanted))

      if (matches.length === 1 && matches[0]) return matches[0].id
      if (matches.length === 0) throw new CliError("not_found", `no chat matches "${reference}"`)

      const names = matches.map((chat) => `${chat.title} (${chat.id})`).join(", ")
      throw new CliError("validation_error", `"${reference}" matches ${matches.length} chats: ${names}`)
    },
  }

  readonly contacts = {
    /** The people this account has a one-to-one chat with, named. */
    list: async (): Promise<Contact[]> => {
      if (this.#offline) return this.#recorded(this.#cache?.contacts.read(ANY_AGE), "contacts")

      await this.#connectOnce()
      const people = await this.#peopleFor(asArray(this.#session().chats))
      const contacts = [...people.values()].filter((contact) => contact.id !== "")
      this.#cache?.contacts.write(contacts)
      return contacts
    },
  }

  readonly messages = {
    list: async (chatId: Id, limit = 20): Promise<Message[]> => {
      if (this.#offline) return this.#recorded(this.#cache?.messages.read(chatId, limit, ANY_AGE), "messages")

      await this.#connectOnce()
      const session = this.#session()

      // `interactive: false` and no CHAT_MARK: reading history must not mark anything read (§19).
      const answer = await this.#wire.chats.history({
        chatId,
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
      const messages = asArray(answer.messages).map((raw) => toMessage(raw, chatId, lookup))
      this.#cache?.messages.write(chatId, messages)
      return messages
    },

    /**
     * Sends one message, retrying **only with the same `cid`**.
     *
     * §17 allows a send to be retried when the protocol has a verified deduplication handle. It has
     * one, measured against MAX on 2026-09-19: sending the same `cid` twice returned the same
     * message id and left **one** copy in the chat — and it held across two separate connections
     * and logins, which is the case a retry actually faces.
     *
     * So one retry, same `cid`, and nothing beyond that. What is still unmeasured is how long the
     * server remembers a `cid`; the two probes were seconds apart. If the retry also fails the
     * answer is `outcome_unknown` — never failed, never sent — and it names the `cid`, because
     * `max send --cid <n>` can then repeat the attempt without risking a second message.
     */
    send: async (chatId: Id, text: string, options: { cid?: number; notify?: boolean } = {}): Promise<Message> => {
      if (this.#offline) throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot send")

      await this.#connectOnce()
      const session = this.#session()
      const cid = options.cid ?? this.#nextCid()
      const request = {
        chatId,
        message: { text, cid, elements: [], attaches: [] },
        notify: options.notify ?? true,
      }

      let answer: Payload
      try {
        answer = await this.#wire.messages.send(request)
      } catch (error) {
        const failure = asCliError(error)
        if (failure.code !== "timeout" && failure.code !== "network_error") throw failure

        // No answer came back, so MAX may already have delivered it. Repeating the identical `cid`
        // is what makes asking again safe rather than reckless.
        try {
          answer = await this.#wire.messages.send(request)
        } catch {
          throw new CliError(
            "outcome_unknown",
            `the message may or may not have been sent (${failure.message}) — ` +
              `\`max send --cid ${cid}\` repeats the attempt without risking a second copy`,
            { cid },
          )
        }
      }

      // What the cache holds for this chat is now one message short of the truth.
      this.#cache?.messages.invalidate(chatId)

      const sent = record(answer.message) ?? answer
      return toMessage(sent, chatId, { names: namesFrom(session.contacts), ...viewer(this.#store) })
    },
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
      throw new CliError(
        "authentication_error",
        `no session for profile "${this.#store.profile}" — run \`max session start\``,
      )
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

  async close(): Promise<void> {
    await this.#connection.close()
  }

  /** What `--offline` can answer with, or a refusal that says how to fix it. */
  #recorded<T>(value: T[] | undefined, what: string): T[] {
    if (value) return value
    throw new CliError(
      "not_found",
      `nothing recorded for ${what} on profile "${this.#store.profile}" — run the command once without \`--offline\``,
    )
  }

  /**
   * **The socket is opened only when something actually needs MAX.**
   *
   * This is the whole point of the cache: a read the cache can answer opens no connection, spends
   * no login, and is over before a socket would have finished its handshake. `connect()` stays
   * public for the one command that must reach MAX to mean anything — starting a session.
   */
  async #connectOnce(): Promise<void> {
    if (!this.#login) await this.connect()
  }

  /**
   * One request: encode against the specification, send, and compare the answer with what we said
   * it would be.
   *
   * **The comparison never decides anything** (`NEED-35`). A response that gained a field is not a
   * mismatch at all — response shapes are loose. What is left is a field we rely on that stopped
   * being what it was, which is worth one line on stderr and nothing more.
   */
  async #send<TOperation extends Operation>(operation: TOperation, request: RequestOf<TOperation>): Promise<Payload> {
    const payload = buildRequest(operation, request)

    let answer: Payload
    try {
      answer = await this.#connection.invoke(operation.opcode, payload)
    } catch (error) {
      throw asCliError(error)
    }

    const note = checkResponse(operation, answer)
    if (note) this.#warn(note)
    return answer
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
      const answer = await this.#wire.contacts.info({ contactIds: [...missing] })
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
}

/** `--offline` was asked for explicitly, so age is not a reason to refuse what was recorded. */
const ANY_AGE = Number.POSITIVE_INFINITY

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
      return new CliError(
        "authentication_error",
        `${error.message} — the session may have expired; run \`max session start\``,
      )
    }
    return new CliError("provider_error", error.message, { operation: String(error.opcode) })
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("did not answer")) return new CliError("timeout", message)
  return new CliError("network_error", message)
}
