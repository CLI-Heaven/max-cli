import { CliError } from "@leemour/cli-core"
import type { CacheStore, PersonOrder, SyncSummary } from "./cache/store.js"
import {
  namesFrom,
  SETTING_FLAGS,
  toChat,
  toContact,
  toFolder,
  toGroupCard,
  toMessage,
  toProfile,
  toReactions,
  toSession,
} from "./domain/map.js"
import type {
  AccountSession,
  AttachmentLink,
  Chat,
  ChatCard,
  ChatKind,
  Contact,
  ContactImport,
  Folder,
  GroupCard,
  GroupSettings,
  Id,
  Inbox,
  InboxChat,
  Message,
  MessageHit,
  Page,
  PersonCard,
  Pin,
  Profile,
  QuotedMessage,
  Reactions,
  WindowedMessage,
} from "./domain/models.js"
import { type Invoke, wireClient } from "./generated/client.generated.js"
import { parseMarkdown } from "./markdown.js"
import { asFirstWord } from "./profile.js"
import { Connection, ProtocolError } from "./protocol/connection.js"
import { asId, type Payload } from "./protocol/frame.js"
import { isId, pickChat, pickPerson } from "./resolve.js"
import { countsIn, type DiagnosticEvent, idsOf } from "./runs/events.js"
import type { SendGuard } from "./sends/guard.js"
import type { AccountAction, ChatAction, SendKind } from "./sends/journal.js"
import { LOGIN_CHATS, startSession } from "./session/handshake.js"
import { type QrLogin, tokenByQr } from "./session/login.js"
import type { SessionStore } from "./session/store.js"
import { WEB_USER_AGENT } from "./spec/identity.js"
import { buildRequest, checkResponse, type Operation, type RequestOf } from "./spec/index.js"
import type { chatsUpdateMembers } from "./spec/operations/chats.js"
import { isImage, readUpload, uploadFile, uploadPhoto } from "./upload.js"

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
  /**
   * One event per request, for whoever is keeping a diagnostic. Injected the way `warn` is: the
   * client reports what it did and never decides where that goes. Absent means nothing is kept.
   */
  events?: (event: DiagnosticEvent) => void
  /** Asked before every send and told its outcome. Absent in tests that are not about it. */
  sends?: SendGuard
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
  readonly #events: (event: DiagnosticEvent) => void
  readonly #sends: SendGuard | undefined
  readonly #invoke = ((operation, request) => this.#send(operation, request)) as Invoke
  readonly #wire = wireClient(this.#invoke)
  #login: Payload | undefined
  #previousCid = 0
  #people: Map<Id, Contact> | undefined
  #merged: SyncSummary | undefined

  constructor({ store, timeoutMs, connection, warn, cache, offline = false, events, sends }: MaxClientOptions) {
    this.#store = store
    this.#connection = connection ?? new Connection(timeoutMs === undefined ? {} : { timeoutMs })
    this.#warn = warn ?? ((message) => process.stderr.write(`${message}\n`))
    this.#cache = cache
    this.#offline = offline
    this.#events = events ?? (() => {})
    this.#sends = sends
  }

  readonly account = {
    me: async (): Promise<Profile> => {
      await this.#connectOnce()
      return toProfile(record(this.#session().profile) ?? {})
    },

    /**
     * Changes the profile everyone sees. **The name goes out whole**: the web client always sends
     * the current first name, so a change to the description alone keeps it from the login.
     */
    update: (change: ProfileChange): Promise<Profile> =>
      this.#change("profile", async () => {
        const current = ownNames(record(this.#session().profile) ?? {})
        const firstName = change.firstName ?? current.firstName
        if (!firstName)
          throw new CliError("validation_error", "MAX needs a first name, and the profile has none — pass --first-name")
        const lastName = change.lastName ?? current.lastName

        const answer = await this.#wire.account.update({
          firstName,
          ...(lastName === undefined ? {} : { lastName }),
          ...(change.description === undefined ? {} : { description: change.description }),
        })
        return toProfile(record(answer.profile) ?? {})
      }),

    sessions: async (): Promise<AccountSession[]> => {
      if (this.#offline)
        throw new CliError("validation_error", "`--offline` reads what was recorded, and sessions are not recorded")
      await this.#connectOnce()
      return asArray((await this.#wire.account.sessions({})).sessions).map(toSession)
    },

    /**
     * Logs every other device out — the owner's phone included — and keeps this one.
     *
     * PyMax reads a replacement token from the answer and the web client reads nothing (`RISK-25`),
     * so both are handled: a token that came back is stored before anything is reported, and then
     * the session is asked for once more, so a MAX that ended this one too says so here rather
     * than on the next command.
     */
    endOtherSessions: (): Promise<AccountSession[]> =>
      this.#change("sessions-end", async () => {
        const answer = await this.#wire.account.closeSessions({})
        const token = answer.token
        if (typeof token === "string" && token !== "") {
          try {
            this.#store.writeToken(token)
          } catch (error) {
            throw new CliError(
              "configuration_error",
              `the other sessions are ended, but the new token for this one could not be saved: ${reasonOf(error)} — run \`max session start\``,
            )
          }
        }

        try {
          return asArray((await this.#wire.account.sessions({})).sessions).map(toSession)
        } catch (error) {
          throw new CliError(
            "authentication_error",
            `the other sessions are ended, and MAX no longer answers this one (${asCliError(error).message}) — run \`max session start\``,
          )
        }
      }),
  }

  /**
   * Obtaining a token rather than using one. The token comes back to the caller, unstored and not yet
   * tried: `adoptToken` logs in with it on a connection of its own before the keyring sees it, so
   * a login that went wrong halfway cannot replace a working session.
   */
  readonly login = {
    byQr: (options: QrLogin): Promise<string> => this.#beforeLogin(() => tokenByQr(this.#wire, options)),
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
    list: async (options: PageRequest = {}): Promise<Page<Chat>> => {
      const { limit, offset = 0, kind, unread } = options
      const query = checkedQuery(options.query)

      if (this.#offline) {
        const recorded = this.#cache
        if (!recorded) this.#recorded(undefined, "chats")
        const store = recorded as CacheStore
        if (store.chats.count() === 0) this.#recorded(undefined, "chats")
        const items = store.chats.page({ limit: limit ?? Number.MAX_SAFE_INTEGER, offset, query, kind, unread })
        return { items, hasMore: offset + items.length < store.chats.count({ query, kind, unread }) }
      }

      await this.#connectOnce()
      const raw = asArray(this.#session().chats)
      const people = await this.#peopleFor(raw)

      // A one-to-one chat has no title of its own — its name is the other person's, and MAX does
      // not put it in the chat object. Without this, the chats a person recognises by name are a
      // column of blanks.
      const chats = raw.map((chat) => {
        const mapped = toChat(chat)
        if (mapped.title !== null || mapped.kind !== "dialog") return mapped

        const partner = this.#partnerOf(chat)
        const name = partner === undefined ? null : (people.get(partner)?.name ?? null)
        return { ...mapped, title: name }
      })

      const cache = this.#cache
      if (!cache) return paged(matching(chats, { query, kind, unread }), limit, offset)

      // Written first, then read back: the titles just resolved have to be in the store before it
      // is asked to order and page over them, and the delta this login carried is only a slice of
      // what it now holds.
      cache.chats.write(chats)
      const items = cache.chats.page({ limit: limit ?? Number.MAX_SAFE_INTEGER, offset, query, kind, unread })
      return { items, hasMore: offset + items.length < cache.chats.count({ query, kind, unread }) }
    },

    /**
     * Turns what the person typed into a chat id.
     *
     * A number is taken as an id. Anything else is matched against chat titles, exactly first and
     * then as a fragment — and **an ambiguous name is an error, not a guess**: sending to the wrong
     * conversation is not undoable, so the caller is shown the candidates and asked to be specific.
     */
    resolve: async (reference: string): Promise<Id> => {
      if (isId(reference)) return reference.trim()
      return pickChat(reference, (await this.chats.list()).items).id
    },

    /**
     * One chat and who is in it, from the list the login just refreshed.
     *
     * ⚠ **An id is checked here, where `resolve` lets any number through** — for a read that is
     * the difference between an answer and a card of nulls for a chat that does not exist.
     */
    show: async (reference: string): Promise<ChatCard> => {
      const { items } = await this.chats.list()
      const chat = isId(reference) ? items.find((one) => one.id === reference.trim()) : pickChat(reference, items)
      if (!chat) throw new CliError("not_found", `no chat ${reference.trim()} among this account's chats`)

      const cache = this.#cache
      return { ...chat, members: chat.kind === "channel" || !cache ? null : cache.chats.members(chat.id) }
    },

    /** What a link leads to, without joining it. */
    inspect: async (link: string): Promise<GroupCard> => {
      if (this.#offline)
        throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot read a link")
      const wire = wireLink(link)
      await this.#connectOnce()
      return toGroupCard(record((await this.#wire.chats.linkInfo({ link: wire })).chat) ?? {})
    },

    join: (link: string): Promise<GroupCard> => {
      const wire = wireLink(link)
      return this.#changeChat(null, "join", async () => {
        const chat = toGroupCard(record((await this.#wire.chats.join({ link: wire })).chat) ?? {})
        return { chatId: chat.id, result: chat }
      })
    },

    leave: async (reference: string): Promise<ChatChange> => {
      const chatId = await this.chats.resolve(reference)
      return this.#changeChat(chatId, "leave", async () => {
        await this.#wire.chats.leave({ chatId })
        return { chatId, result: { chatId, action: "leave", people: [], chat: null } }
      })
    },

    /**
     * Not retried, unlike a message: a second attempt with a new `cid` is a second group, and
     * whether MAX deduplicates a creation by `cid` is not measured.
     */
    create: (title: string, people: string[] = []): Promise<GroupCard> =>
      this.#changeChat(null, "create", async () => {
        const userIds = await this.#personIds(people)
        const answer = await this.#wire.messages.send({
          message: {
            cid: this.#nextCid(),
            attaches: [{ _type: "CONTROL", event: "new", chatType: "CHAT", title, userIds }],
          },
          notify: true,
        })
        const chat = toGroupCard(record(answer.chat) ?? {})
        return { chatId: chat.id, result: chat, people: userIds.length }
      }),

    members: {
      add: (reference: string, people: string[], { history = true }: { history?: boolean } = {}) =>
        this.#updateMembers(reference, people, "members.add", { operation: "add", showHistory: history }),
      remove: (reference: string, people: string[]) =>
        this.#updateMembers(reference, people, "members.remove", { operation: "remove", cleanMsgPeriod: 0 }),
    },

    admins: {
      add: (reference: string, person: string, rights: AdminRight[]) =>
        this.#updateMembers(reference, [person], "admins.add", {
          operation: "add",
          type: "ADMIN",
          permissions: rights.reduce((sum, right) => sum | ADMIN_RIGHTS[right], 0),
        }),
      remove: (reference: string, person: string) =>
        this.#updateMembers(reference, [person], "admins.remove", { operation: "remove", type: "ADMIN" }),
    },

    requests: {
      list: async (reference: string): Promise<Contact[]> => {
        if (this.#offline)
          throw new CliError("validation_error", "`--offline` reads what was recorded; join requests never are")
        const chatId = await this.chats.resolve(reference)
        await this.#connectOnce()
        const answer = await this.#wire.chats.members({ chatId, type: "JOIN_REQUEST", count: JOIN_REQUESTS })
        return asArray(answer.members).map((member) => toContact(record(member.contact) ?? {}))
      },
      accept: (reference: string, people: string[]) =>
        this.#updateMembers(reference, people, "requests.accept", {
          operation: "add",
          type: "JOIN_REQUEST",
          showHistory: true,
        }),
      decline: (reference: string, people: string[]) =>
        this.#updateMembers(reference, people, "requests.decline", { operation: "remove", type: "JOIN_REQUEST" }),
    },

    update: async (reference: string, { title, description }: { title?: string; description?: string }) => {
      if (title === undefined && description === undefined) {
        throw new CliError("validation_error", "nothing to change — give --title, --description or both")
      }
      const chatId = await this.chats.resolve(reference)
      return this.#changeChat(chatId, "update", async () => {
        const answer = await this.#wire.chats.update({
          chatId,
          ...(title === undefined ? {} : { theme: title }),
          ...(description === undefined ? {} : { description }),
        })
        return { chatId, result: toGroupCard(record(answer.chat) ?? {}) }
      })
    },

    /** With no changes, reads the settings the login carried; nothing is sent. */
    settings: async (reference: string, changes: Partial<GroupSettings> = {}): Promise<GroupCard> => {
      if (this.#offline)
        throw new CliError("validation_error", "`--offline` reads what was recorded; settings never are")
      const chatId = await this.chats.resolve(reference)
      const entries = Object.entries(changes).filter(([, value]) => value !== undefined)
      if (entries.length === 0) {
        await this.#connectOnce()
        const raw = asArray(this.#session().chats).find((chat) => asId(chat.id) === chatId)
        if (!raw) throw new CliError("not_found", `no chat ${chatId} among this account's chats`)
        return toGroupCard(raw)
      }

      const options = Object.fromEntries(
        entries.map(([ours, value]) => [SETTING_FLAGS[ours as keyof GroupSettings], value as boolean]),
      )
      return this.#changeChat(chatId, "settings", async () => {
        const answer = await this.#wire.chats.update({ chatId, options })
        return { chatId, result: toGroupCard(record(answer.chat) ?? {}) }
      })
    },

    /** The old link stops working for everyone who has it. */
    resetLink: async (reference: string): Promise<GroupCard> => {
      const chatId = await this.chats.resolve(reference)
      return this.#changeChat(chatId, "link.reset", async () => {
        const answer = await this.#wire.chats.update({ chatId, revokePrivateLink: true })
        return { chatId, result: toGroupCard(record(answer.chat) ?? {}) }
      })
    },
  }

  readonly contacts = {
    /**
     * The people this account has a one-to-one chat with, named, newest conversation first.
     *
     * **It answers from the store**, which the login has just brought up to date (`#mergeLogin`),
     * so the order and the paging happen in SQL over every person we know rather than over the
     * handful this particular login mentioned. A delta carries almost nothing after the first run;
     * rendering the response instead of the store would show an empty list on the second command.
     *
     * ⚠ **A group member is not in this answer** and nothing marks them as excluded: the query
     * asks for people a *dialog* exists with, and they are outside it (`NEED-105`). They are in
     * the store, with the chats they share with us, for the commands that will want them.
     */
    list: async (options: PageRequest = {}): Promise<Page<Contact>> => {
      const { order = "recent", limit, offset = 0 } = options
      const query = checkedQuery(options.query)

      // The same query as the online path, so `--offline` cannot answer with people the other
      // one deliberately leaves out — a group member is not a contact in either mode.
      if (this.#offline) {
        const recorded = this.#cache
        if (!recorded || recorded.people.countContacts() === 0) this.#recorded(undefined, "contacts")
        return this.#pageOfContacts(recorded as CacheStore, order, limit, offset, query)
      }

      await this.#connectOnce()
      const people = await this.#peopleFor(asArray(this.#session().chats))
      const cache = this.#cache

      // No store — it failed to open, and that is not a reason to lose the answer MAX just gave.
      // What is lost is only the ordering and the paging the store does better.
      if (!cache)
        return paged(
          matchingPeople(
            [...people.values()].filter((contact) => contact.id !== ""),
            query,
          ),
          limit,
          offset,
        )

      return this.#pageOfContacts(cache, order, limit, offset, query)
    },

    /**
     * **Start again from zero**: forget the marker, so this login asks for the whole collection
     * rather than for what changed, and name everybody it mentions.
     *
     * It is a repair tool, not the way contacts arrive. The delta rides on the login every command
     * already performs, so there is nothing to schedule and no budget to spend — what this is for
     * is a store that has drifted, or a full re-take after a schema rebuild threw the rows away.
     * It is also the only thing that could ever prune somebody MAX has stopped returning, which is
     * the second reason it exists.
     */
    /**
     * Finds whoever MAX has under a phone number. A lookup, not an add: nothing changes on the
     * account. ⚠ The number is never repeated in an error — it is the one field here the sixth
     * constraint is about.
     */
    lookup: async (phone: string): Promise<Contact> => {
      if (this.#offline)
        throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot look a number up")
      const number = wirePhone(phone)
      await this.#connectOnce()
      const contact = record((await this.#wire.contacts.byPhone({ phone: number })).contact)
      if (!contact) throw new CliError("not_found", "MAX has nobody under that number")
      return this.#remember(toContact(contact))
    },

    add: (reference: string): Promise<Contact> => this.#contactAction("contact-add", "ADD", reference),

    remove: (reference: string): Promise<Contact> => this.#contactAction("contact-remove", "REMOVE", reference),

    /** Uploads phone numbers to MAX — other people's — under the names they were saved with. */
    import: (entries: PhoneBookEntry[]): Promise<ContactImport> =>
      this.#change("contact-import", async () => {
        if (entries.length === 0) throw new CliError("validation_error", "no numbers to import")
        const contactList: Record<string, { firstName: string }> = {}
        for (const entry of entries) contactList[wirePhone(entry.phone)] = { firstName: entry.name }

        const answer = await this.#wire.contacts.import({ contactList })
        return {
          sent: Object.keys(contactList).length,
          recognised: Object.keys(record(answer.phones) ?? {}),
          contacts: asArray(answer.contacts)
            .map(toContact)
            .map((contact) => this.#remember(contact)),
        }
      }),

    /**
     * One person and the chats we share, **whoever they are** — a group member is as findable as
     * a contact. `NEED-105` decides who `list` lists, not who can be looked up.
     *
     * Only from the store: the shared chats are its `chat_members`, which nothing else holds.
     */
    show: async (reference: string): Promise<PersonCard> => {
      const cache = this.#cache
      if (!cache) {
        throw new CliError(
          "configuration_error",
          `there is no local store for profile "${this.#store.profile}" to look people up in — the note above says why`,
        )
      }

      if (this.#offline) {
        if (cache.people.count() === 0) this.#recorded(undefined, "people")
      } else {
        await this.#connectOnce()
        await this.#peopleFor(asArray(this.#session().chats))
      }

      const person = pickPerson(reference, cache)
      const chats = cache.people
        .sharedChats(person.id)
        .map(({ id, title, kind, lastMessageAt }) => ({ id, title, kind, lastMessageAt }))
      return { ...person, chats }
    },

    sync: async (): Promise<SyncSummary & { full: true }> => {
      if (this.#offline) {
        throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot sync")
      }

      const cache = this.#cache
      if (!cache) {
        throw new CliError(
          "configuration_error",
          `there is no local store for profile "${this.#store.profile}" to sync into — the note above says why`,
        )
      }

      // Before connecting, or the login would carry the marker this is meant to discard.
      cache.forgetSyncMarker()
      await this.#connectOnce()

      // The login names a fraction of the people in its own chats, so a full take that stopped
      // here would store ids without names for most of them.
      await this.#peopleFor(asArray(this.#session().chats))

      return { ...(this.#merged ?? { known: 0, added: 0, changed: 0 }), known: cache.people.count(), full: true }
    },
  }

  readonly messages = {
    /**
     * **Searches what this machine has read, and never asks MAX.**
     *
     * MAX has no search operation in our registry — nine opcodes, none of them a query — so there
     * is nothing to ask. That makes this the one read that is local by nature rather than by
     * choice, and it is the opposite of the rule every other read follows (`df6792a`: the record
     * does not answer a read).
     *
     * ⚠ **So it finds what has been read, not what exists.** A chat nobody has opened contributes
     * nothing, and there is no way for the answer to know that. The command says so on stderr
     * rather than leaving the reader to infer it from a short list, and `max messages list <chat>`
     * is what fills the gap.
     *
     * It opens no connection at all, which also means it costs no login (`RISK-2`).
     */
    search: async (
      query: string,
      options: { chatId?: Id; limit?: number; offset?: number } = {},
    ): Promise<Page<MessageHit>> => {
      const checked = checkedQuery(query)
      if (checked === undefined) throw new CliError("validation_error", "a search needs something to search for")

      const cache = this.#cache
      if (!cache) {
        throw new CliError(
          "not_found",
          "searching reads the local copy, and this profile has none — run `max messages list <chat>` first",
        )
      }

      const { chatId, limit = 20, offset = 0 } = options
      const items = cache.messages.search({ query: checked, ...(chatId ? { chatId } : {}), limit, offset })
      const total = cache.messages.countSearch({ query: checked, ...(chatId ? { chatId } : {}) })
      return { items, hasMore: offset + items.length < total }
    },

    /**
     * **Paged backwards through time, not by page number.** MAX's history is already anchored —
     * it takes a moment and answers with what came before it — so `--before` is exact where a page
     * number over a live conversation would repeat and skip rows.
     *
     * `after` reads the other way and **leaves the anchor out**, so the next page's hint does not
     * repeat a row. MAX puts it in — measured 2026-09-23, `forward: n` with `backward: 0` starts
     * with the message it was given — so one more is asked for and anything not later is dropped.
     * `before` keeps the anchor, as it always has.
     *
     * `hasMore` here is a claim about the copy we hold, never about the chat: a full page back is
     * the only evidence there is that another page exists.
     */
    list: async (
      chatId: Id,
      options: { limit?: number; before?: number; after?: number } = {},
    ): Promise<Page<Message>> => {
      const limit = options.limit ?? 20
      const { before, after } = options

      if (after !== undefined) {
        const found = this.#offline
          ? this.#recorded(this.#cache?.messages.window(chatId, after, 0, limit + 1), "messages")
          : await this.#history(chatId, { from: after, backward: 0, forward: limit + 1 })
        const later = found.filter((message) => Date.parse(message.timestamp) > after)
        return { items: later.slice(0, limit), hasMore: later.length > limit }
      }

      if (this.#offline) {
        const cache = this.#cache
        const stored =
          before === undefined
            ? cache?.messages.read(chatId, limit, ANY_AGE)
            : cache?.messages.window(chatId, before, limit, 0)
        const items = this.#recorded(stored, "messages")
        return { items, hasMore: items.length >= limit }
      }

      const messages = await this.#history(chatId, { from: before ?? Date.now(), backward: limit, forward: 0 })
      return { items: messages, hasMore: messages.length >= limit }
    },

    /**
     * **One message and a window either side of it**, oldest first, the one asked for marked
     * `anchor: true`.
     *
     * Measured 2026-09-22: from a message's own time, `backward: n` answers n messages ending with
     * it and `forward: n` the n after it. Its time comes from its id, so no stored copy is needed.
     * Correction 2026-09-23: that holds with `backward` above zero; with `backward: 0`, `forward`
     * starts with the message itself (`messages.list` with `after` depends on the difference).
     *
     * ⚠ **A message that is gone is refused, not replaced by its neighbour** — MAX answers with
     * whatever is nearest, and showing that as the message asked for would be a quiet lie.
     */
    around: async (
      chatId: Id,
      messageId: Id,
      { before = 0, after = 0, reactions = true }: { before?: number; after?: number; reactions?: boolean } = {},
    ): Promise<WindowedMessage[]> => {
      const time = timeOfMessageId(messageId)
      if (time === undefined) throw new CliError("validation_error", `"${messageId}" is not a message id`)

      const found = this.#offline
        ? (this.#cache?.messages.window(chatId, time, before + 1, after) ?? [])
        : await this.#history(chatId, { from: time, backward: before + 1, forward: after }, { reactions })

      if (!found.some((message) => message.id === messageId)) {
        throw new CliError("not_found", `no message ${messageId} in chat ${chatId} — deleted, or in another chat`)
      }
      return found.map((message) => (message.id === messageId ? { ...message, anchor: true } : message))
    },

    /**
     * **Where each attachment of one message can be downloaded from.** A photo and an audio carry
     * their link; a file and a video carry only an id, and MAX answers the link for it (measured
     * 2026-09-23). A video is taken as its largest MP4 — the streaming renditions are playlists,
     * not a file. An attachment with no link to give is left out and named in `skipped`.
     */
    links: async (chatId: Id, messageId: Id): Promise<{ links: AttachmentLink[]; skipped: string[] }> => {
      if (this.#offline)
        throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot download")
      const [message] = await this.messages.around(chatId, messageId, { reactions: false })
      if (!message) throw new CliError("not_found", `no message ${messageId} in chat ${chatId}`)

      const links: AttachmentLink[] = []
      const skipped: string[] = []
      for (const attachment of message.attachments) {
        const { kind, name } = attachment
        if (attachment.fileId) {
          const answer = await this.#wire.attachments.file({ chatId, messageId, fileId: attachment.fileId })
          const url = typeof answer.url === "string" ? answer.url : undefined
          if (url)
            links.push({ kind, url, ...(name ? { name } : {}), ...(answer.unsafe === true ? { unsafe: true } : {}) })
          else skipped.push(kind)
        } else if (attachment.videoId) {
          const answer = await this.#wire.attachments.video({ chatId, messageId, videoId: attachment.videoId })
          const url = largestMp4(answer)
          if (url) links.push({ kind, url })
          else skipped.push(kind)
        } else if (attachment.url && (kind === "photo" || kind === "audio")) {
          links.push({ kind, url: attachment.url })
        } else {
          skipped.push(kind)
        }
      }
      return { links, skipped }
    },

    /**
     * Turns what `--before` or `--after` was given into a moment.
     *
     * **ISO 8601 is a time; a bare integer is a message id**, and a message id carries its own time
     * (`timeOfMessageId`). Deciding between the two by length would be a trap that fires the first
     * time either changes size, so the rule is what the string looks like.
     */
    moment: (reference: string, flag = "--before"): number => {
      const wanted = reference.trim()
      const time = /^\d+$/.test(wanted) ? timeOfMessageId(wanted) : Date.parse(wanted)
      if (time === undefined || Number.isNaN(time)) {
        throw new CliError("validation_error", `${flag} takes a message id or an ISO 8601 time, not "${wanted}"`)
      }
      return time
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
     * `max messages send … --cid <n>` can then repeat the attempt without risking a second message.
     */
    send: async (
      chatId: Id,
      text: string,
      options: { cid?: number; notify?: boolean; replyTo?: Id; markdown?: boolean; files?: string[] } = {},
    ): Promise<Message> => {
      if (this.#offline) throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot send")

      // Before connecting: a refused send never opens a socket when the chat was given as an id.
      try {
        this.#sends?.check(chatId)
      } catch (error) {
        this.#sends?.record({ chatId, outcome: "refused", errorCode: asCliError(error).code })
        throw error
      }

      const cid = options.cid ?? this.#nextCid()
      const files = await Promise.all(
        (options.files ?? []).map(async (path) => ({ path, bytes: await readUpload(path), photo: isImage(path) })),
      )
      // Measured 2026-09-24: photos share a message, but a file with anything beside it is refused `proto.payload`.
      if (files.some((file) => !file.photo) && files.length > 1) {
        throw new CliError(
          "validation_error",
          "a file goes in a message of its own — photos can share one; send them apart",
        )
      }
      const attachments = files.map(({ bytes, photo }) => ({
        kind: photo ? ("photo" as const) : ("file" as const),
        bytes: bytes.length,
      }))
      const summary = attachments.length > 0 ? { attachments } : {}
      try {
        const sent = await this.#deliver(chatId, text, cid, { ...options, files })
        this.#sends?.record({ chatId, outcome: "sent", messageId: sent.id, cid, length: text.length, ...summary })
        return sent
      } catch (error) {
        const failure = asCliError(error)
        this.#sends?.record({
          chatId,
          outcome: failure.code === "outcome_unknown" ? "outcome_unknown" : "failed",
          cid,
          length: text.length,
          ...summary,
          errorCode: failure.code,
        })
        throw error
      }
    },

    /** Puts one emoji reaction on a message; it replaces the one you had. */
    react: (chatId: Id, messageId: Id, emoji: string): Promise<Reactions> =>
      this.#reaction(chatId, messageId, () =>
        this.#wire.messages.react({ chatId, messageId, reaction: { reactionType: "EMOJI", id: emoji } }),
      ),

    /** Takes your reaction off. Measured 2026-09-24: a second call is answered the same, not refused. */
    unreact: (chatId: Id, messageId: Id): Promise<Reactions> =>
      this.#reaction(chatId, messageId, () => this.#wire.messages.unreact({ chatId, messageId })),

    /**
     * Changes the text of one of the owner's own messages. The person may have read it already.
     *
     * **Its attachments are sent back as history gives them**: measured 2026-09-24, an edit with
     * none removes a photo from the message. Refused before asking MAX when the message is not the
     * owner's, is a forward, or carries anything but photos — the web client offers none of those. MAX's own limit is
     * `edit-timeout` from LOGIN, 604800 s when measured; past it MAX refuses and that is the answer.
     * Not retried, like a reaction.
     */
    edit: async (chatId: Id, messageId: Id, text: string, { markdown = false } = {}): Promise<Message> => {
      if (this.#offline) throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot edit")
      this.#guard(chatId, "edit", messageId)

      try {
        await this.#connectOnce()
        const lookup = { names: namesFrom(this.#session().contacts), ...viewer(this.#store) }
        const raw = await this.#rawMessage(chatId, messageId)
        const current = toMessage(raw, chatId, lookup)
        if (current.outgoing !== true) {
          throw new CliError("validation_error", `message ${messageId} is not yours — only your own can be edited`)
        }
        if (record(raw.link)?.type === "FORWARD") {
          throw new CliError("validation_error", `message ${messageId} is a forward — a forward cannot be edited`)
        }
        // Only a photo was measured to survive the round trip; the web client refuses files, stickers and the rest too.
        const other = current.attachments.find((attachment) => attachment.kind !== "photo")
        if (other) {
          throw new CliError(
            "validation_error",
            `message ${messageId} carries a ${other.kind} — only text and photos can be edited`,
          )
        }

        const { text: plain, markup } = markdown ? parseMarkdown(text) : { text, markup: [] }
        const answer = await this.#wire.messages.edit({
          chatId,
          messageId,
          text: plain,
          elements: markup,
          attachments: asArray(raw.attaches),
        })
        this.#cache?.messages.invalidate(chatId)
        this.#sends?.record({ chatId, kind: "edit", outcome: "sent", messageId, length: text.length })
        return toMessage(record(answer.message) ?? raw, chatId, lookup)
      } catch (error) {
        const failure = asCliError(error)
        this.#sends?.record({ chatId, kind: "edit", outcome: "failed", messageId, errorCode: failure.code })
        throw error
      }
    },

    /**
     * Forwards one message into another chat: a new message there, so it goes through `#deliver`
     * — the same `cid`, the same one retry — and counts against `sendsPerHour`.
     */
    forward: async (
      fromChatId: Id,
      messageId: Id,
      toChatId: Id,
      options: { cid?: number; notify?: boolean } = {},
    ): Promise<Message> => {
      if (this.#offline)
        throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot forward")
      this.#guard(toChatId, "forward")

      const cid = options.cid ?? this.#nextCid()
      try {
        const sent = await this.#deliver(toChatId, "", cid, {
          ...options,
          forward: { chatId: fromChatId, messageId },
          repeat: `max messages forward ${fromChatId} ${messageId} --to ${toChatId}`,
        })
        this.#sends?.record({ chatId: toChatId, kind: "forward", outcome: "sent", messageId: sent.id, cid })
        return sent
      } catch (error) {
        const failure = asCliError(error)
        this.#sends?.record({
          chatId: toChatId,
          kind: "forward",
          outcome: failure.code === "outcome_unknown" ? "outcome_unknown" : "failed",
          cid,
          errorCode: failure.code,
        })
        throw error
      }
    },

    /**
     * Pins one message in a chat, or with `null` unpins whatever is pinned — `pinMessageId: 0` is
     * how the web client unpins. No notification unless asked (`NEED-196`). Not retried.
     *
     * **Never in a personal chat**: the web client's dialog class answers `viewerCanPin` with `false`, and
     * MAX refused both in Saved messages and in a dialog with a person (measured 2026-09-24, `FIND-107`).
     * A chat the login did not list is left to MAX. In a group, pin and unpin were measured the same day.
     */
    pin: async (chatId: Id, messageId: Id | null, { notify = false } = {}): Promise<Pin> => {
      if (this.#offline) throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot pin")
      this.#guard(chatId, "pin", messageId ?? undefined)

      try {
        await this.#connectOnce()
        const known = asArray(this.#session().chats).find((raw) => asId(raw.id) === chatId)
        if (known && toChat(known).kind === "dialog") {
          throw new CliError(
            "validation_error",
            `chat ${chatId} is a personal chat — MAX pins only in groups and channels`,
          )
        }
        await this.#wire.chats.update({ chatId, pinMessageId: messageId ?? "0", notifyPin: notify })
        this.#sends?.record({ chatId, kind: "pin", outcome: "sent", ...(messageId ? { messageId } : {}) })
        return { chatId, pinned: messageId }
      } catch (error) {
        this.#sends?.record({ chatId, kind: "pin", outcome: "failed", errorCode: asCliError(error).code })
        throw error
      }
    },
  }

  readonly folders = {
    list: async (): Promise<Folder[]> => (await this.#folders()).map(toFolder),

    create: (title: string, chats: string[] = []): Promise<Folder> =>
      this.#change("folder-create", async () => {
        const include = await Promise.all(chats.map((chat) => this.chats.resolve(chat)))
        const answer = await this.#wire.folders.update({
          id: crypto.randomUUID(),
          title: folderTitle(title),
          include,
          filters: [],
          options: [],
        })
        return toFolder(record(answer.folder) ?? {})
      }),

    /**
     * **The folder goes back whole**, as the web client sends it: an edit that left out the chats
     * would empty the folder. What MAX keeps for itself — `sourceId`, `updateTime` — is not sent.
     */
    update: (reference: string, change: FolderChange): Promise<Folder> =>
      this.#change("folder-update", async () => {
        const folder = pickFolder(reference, await this.#folders())
        const added = await Promise.all((change.add ?? []).map((chat) => this.chats.resolve(chat)))
        const removed = new Set(await Promise.all((change.remove ?? []).map((chat) => this.chats.resolve(chat))))
        const touchesChats = added.length > 0 || removed.size > 0
        const current = toFolder(folder).chatIds
        const include = [...new Set([...current, ...added])].filter((id) => !removed.has(id))

        const answer = await this.#wire.folders.update({
          id: String(folder.id),
          title: change.title === undefined ? String(folder.title ?? "") : folderTitle(change.title),
          ...(Array.isArray(folder.include) || touchesChats ? { include } : {}),
          filters: Array.isArray(folder.filters) ? folder.filters : [],
          options: Array.isArray(folder.options) ? folder.options : [],
          ...(Array.isArray(folder.favorites) ? { favorites: folder.favorites } : {}),
        })
        return toFolder(record(answer.folder) ?? {})
      }),

    /** The folder only — its chats stay where they are. */
    delete: (reference: string): Promise<Folder> =>
      this.#change("folder-delete", async () => {
        const folder = pickFolder(reference, await this.#folders())
        await this.#wire.folders.delete({ folderIds: [String(folder.id)] })
        return toFolder(folder)
      }),
  }

  readonly inbox = {
    /**
     * Other people's unread messages, as MAX counts them: for each chat with a count, its newest
     * that many. Reading changes nothing — no `CHAT_MARK` — so the same messages come back until
     * they are read somewhere else. That is right for a person and wrong for a scheduled run,
     * which is what `since` is for.
     */
    unread: async ({ limit }: { limit: number }): Promise<Inbox> => {
      const chats = (await this.chats.list()).items
      const waiting = byRecency(chats.filter((chat) => (chat.unreadCount ?? 0) > 0))
      const { read, skipped } = capped(waiting)

      const found: InboxChat[] = []
      for (const { id, title, kind, unreadCount } of read) {
        const count = unreadCount ?? 0
        const wanted = Math.min(count, limit)
        const { items } = await this.messages.list(id, { limit: wanted })
        const theirs = items.slice(-wanted).filter((message) => message.outgoing !== true)
        if (theirs.length > 0) found.push({ id, title, kind, unreadCount, messages: theirs, more: count > limit })
      }

      return { mode: "unread", chats: found, skipped, partial: !this.#cache && chats.length >= LOGIN_CHATS }
    },

    /**
     * Other people's messages in every chat that changed after `since`.
     *
     * A chat changed if its last message is later than `since`; the chat list says so without a
     * request, and with a store it covers every chat, not only the ones this login named. Each
     * changed chat then costs one history read of its newest `limit` — the newest, because the
     * reader wants what just arrived, and one request rather than paging forward to reach it.
     *
     * **Everything is cut at the chat list's newest message**, the snapshot this login took. The
     * reads run one after another, so a chat read early can gain a message while a later one is
     * read; had the saved point followed the later read, that message would sit behind it and
     * never show. Anything newer than the snapshot waits for the next run and shows once there.
     */
    since: async ({ since, limit }: { since: number; limit: number }): Promise<Inbox> => {
      const chats = (await this.chats.list()).items
      const changed = byRecency(
        chats.filter((chat) => chat.lastMessageAt !== null && Date.parse(chat.lastMessageAt) > since),
      )
      const cut = Math.max(since, ...changed.map((chat) => Date.parse(chat.lastMessageAt ?? "")))
      const { read, skipped } = capped(changed)

      let until = since
      const found: InboxChat[] = []
      for (const { id, title, kind, unreadCount } of read) {
        const { items } = await this.messages.list(id, { limit })
        const fresh = items.filter((message) => {
          const time = Date.parse(message.timestamp)
          return time > since && time <= cut
        })
        for (const message of fresh) until = Math.max(until, Date.parse(message.timestamp))

        const theirs = fresh.filter((message) => message.outgoing !== true)
        if (theirs.length > 0)
          found.push({ id, title, kind, unreadCount, messages: theirs, more: fresh.length >= limit })
      }

      return {
        mode: "new",
        since: new Date(since).toISOString(),
        until: new Date(until).toISOString(),
        chats: found,
        skipped,
        partial: !this.#cache && chats.length >= LOGIN_CHATS && changed.length === chats.length,
      }
    },
  }

  /**
   * A reaction is seen by the other person, so it goes through the send guard and the send log like a
   * message. Not retried: a reaction lost in transit costs a second command, and nothing about it is
   * measured to make a blind repeat safe.
   */
  async #reaction(chatId: Id, messageId: Id, call: () => Promise<Payload>): Promise<Reactions> {
    if (this.#offline) throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot react")

    try {
      this.#sends?.check(chatId, "reaction")
    } catch (error) {
      this.#sends?.record({ chatId, kind: "reaction", outcome: "refused", errorCode: asCliError(error).code })
      throw error
    }

    try {
      await this.#connectOnce()
      const answer = await call()
      this.#sends?.record({ chatId, kind: "reaction", outcome: "sent", messageId })
      return toReactions(record(answer.reactionInfo) ?? {})
    } catch (error) {
      this.#sends?.record({ chatId, kind: "reaction", outcome: "failed", messageId, errorCode: asCliError(error).code })
      throw error
    }
  }

  /** Asks the send guard, and writes a refusal to the send journal before passing it on. */
  #guard(chatId: Id, kind: SendKind, messageId?: Id): void {
    try {
      this.#sends?.check(chatId, kind)
    } catch (error) {
      this.#sends?.record({
        chatId,
        kind,
        outcome: "refused",
        ...(messageId ? { messageId } : {}),
        errorCode: asCliError(error).code,
      })
      throw error
    }
  }

  /** One message as MAX sends it, for what the domain model drops — its attachments whole, its link. */
  async #rawMessage(chatId: Id, messageId: Id): Promise<Payload> {
    const time = timeOfMessageId(messageId)
    if (time === undefined) throw new CliError("validation_error", `"${messageId}" is not a message id`)
    const answer = await this.#wire.chats.history({
      chatId,
      from: time,
      forward: 0,
      backward: 1,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
      interactive: false,
    })
    const found = asArray(answer.messages)
      .map((raw) => record(raw) ?? {})
      .find((raw) => asId(raw.id) === messageId)
    if (!found)
      throw new CliError("not_found", `no message ${messageId} in chat ${chatId} — deleted, or in another chat`)
    return found
  }

  async #deliver(
    chatId: Id,
    text: string,
    cid: number,
    options: {
      notify?: boolean
      replyTo?: Id
      forward?: { chatId: Id; messageId: Id }
      markdown?: boolean
      files?: { path: string; bytes: Buffer; photo: boolean }[]
      /** The command that repeats this attempt, named in `outcome_unknown`. */
      repeat?: string
    },
  ): Promise<Message> {
    await this.#connectOnce()
    const session = this.#session()
    const attaches = []
    for (const file of options.files ?? []) attaches.push(await this.#upload(file))
    const { text: plain, markup } = options.markdown ? parseMarkdown(text) : { text, markup: [] }
    // A forward carries no text or markup of its own — the web client leaves both out, and so was it measured.
    const content = options.forward
      ? { link: { type: "FORWARD" as const, ...options.forward } }
      : {
          text: plain,
          elements: markup,
          ...(options.replyTo ? { link: { type: "REPLY" as const, messageId: options.replyTo } } : {}),
        }
    const request = { chatId, message: { cid, attaches, ...content }, notify: options.notify ?? true }

    let answer: Payload
    try {
      answer = await this.#untilAttachmentsReady(() => this.#wire.messages.send(request))
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
            `\`${options.repeat ?? "max messages send <chat> <text>"} --cid ${cid}\` repeats the attempt without risking a second copy`,
          { cid },
        )
      }
    }

    // What the cache holds for this chat is now one message short of the truth.
    this.#cache?.messages.invalidate(chatId)

    const sent = record(answer.message) ?? answer
    return toMessage(sent, chatId, { names: namesFrom(session.contacts), ...viewer(this.#store) })
  }

  /**
   * Opens the connection and logs in with the stored token, or with one offered for trial.
   *
   * The login response carries the profile, the chats, the contacts and recent messages, so most
   * commands need no further request — measured against MAX on 2026-09-19.
   *
   * **A candidate token is tried and not stored**, which is what lets `adoptToken` write to the
   * keyring only after MAX has accepted it. Nothing here writes a token; see `session/adopt.ts`.
   */
  async connect({ token: candidate }: { token?: string } = {}): Promise<void> {
    const token = candidate ?? this.#store.readToken()
    if (!token) {
      // The fix has to carry the profile, or it logs the wrong one in: a name nobody has logged
      // in under is the ordinary shape of this failure now that the first word is the profile.
      throw new CliError(
        "authentication_error",
        `no session for profile "${this.#store.profile}" — run \`max ${asFirstWord(this.#store.profile)}session start\``,
      )
    }

    const state = this.#store.readState()

    const sync = this.#cache?.syncMarker()

    try {
      await this.#connection.open()
      this.#login = await startSession(this.#invoke, {
        token,
        deviceId: state.deviceId,
        ...(sync === undefined ? {} : { sync }),
      })
    } catch (error) {
      throw asCliError(error)
    }

    const viewerId = toProfile(record(this.#login.profile) ?? {}).id

    // **Before `writeState`**, so a login we are about to refuse does not count itself or move
    // `lastLoginAt`. A profile is a person, not a directory name: if this token belongs to someone
    // else, every later command in this process would send as them and nothing would say so.
    // Switching accounts has a door already — `session end` clears the id along with the token.
    if (viewerId && state.viewerId && viewerId !== state.viewerId) {
      throw new CliError(
        "authentication_error",
        `this token is for a different account than profile "${this.#store.profile}" was set up with — ` +
          `run \`max ${asFirstWord(this.#store.profile)}session end\` first if you meant to switch`,
      )
    }

    this.#store.writeState({
      ...state,
      ...(viewerId ? { viewerId } : {}),
      logins: state.logins + 1,
      lastLoginAt: new Date().toISOString(),
    })

    this.#keepRotatedToken(token)
    this.#mergeLogin(viewerId)
  }

  /**
   * **MAX offers a replacement for a credential that has aged, and until 2026-09-22 we threw it
   * away** — measured, `pnpm probe:token`. Presenting a token pasted months earlier answers with a
   * different one; presenting *that* one answers with the same one back, so this writes once and
   * then stops rather than on every command.
   *
   * The old token keeps working — the last months are the proof — so this is hygiene, not repair.
   *
   * ⚠ **After the identity refusal above, never before it.** A token belonging to somebody else
   * reaches this method only if that check has already let it through; persisting it earlier would
   * overwrite the owner's working credential with a stranger's — a worse version of the defect
   * `MAX-12` exists to fix.
   *
   * **A keyring that will not take it does not fail the command.** The write can fail for reasons
   * that have nothing to do with the command being run — a locked keyring, no session bus — and
   * the old token still works, which is what makes carrying on correct. The reason goes to the
   * diagnostic stream, because failing quietly is not failing invisibly (`NEED-97`).
   *
   * Nothing here prints, returns or compares-aloud the value: the only comparison is against the
   * token we sent, and the only thing that leaves is whether a write failed.
   */
  #keepRotatedToken(sent: string): void {
    const rotated = this.#session().token
    if (typeof rotated !== "string" || rotated === "" || rotated === sent) return

    try {
      this.#store.writeToken(rotated)
    } catch (error) {
      this.#warn(`the refreshed session could not be saved, so the previous one is still in use: ${reasonOf(error)}`)
    }
  }

  /**
   * Writes what the login just told us into the store, **before the command renders**, so a
   * listing prints the names this run brought rather than the previous run's.
   *
   * ⚠ **A delta is mostly empty and that is correct.** After the first login MAX sends only what
   * changed, so an absent person is an unchanged person — never a departed one. Nothing here
   * deletes, with the single exception of a chat's membership, which MAX restates in full whenever
   * it sends that chat at all.
   *
   * **It never fails the command.** Nobody asked for the store; a locked database or a full disk
   * must not lose an answer MAX has already given. The reason goes to the diagnostic stream,
   * because failing quietly is not the same as failing invisibly (`NEED-97`) — and the marker
   * stays where it was, so the next login asks for the same delta again rather than for changes
   * since rows that were never written.
   */
  #mergeLogin(viewerId: string | undefined): void {
    const cache = this.#cache
    const marker = asMarker(this.#session().time)
    if (!cache || marker === undefined) return

    const chats = asArray(this.#session().chats)
    const members = new Map<Id, Id[]>()
    for (const raw of chats) {
      const chat = toChat(raw)
      // A channel lists four of its hundred and seventy-eight thousand subscribers, so its
      // `participants` is not a membership — storing it would be storing a wrong answer.
      if (!chat.id || chat.kind === "channel") continue
      const participants = this.#participantsOf(raw, viewerId)
      if (participants !== undefined) members.set(chat.id, participants)
    }

    try {
      this.#merged = cache.mergeDelta({
        chats: chats.map(toChat).filter((chat) => chat.id !== ""),
        people: asArray(this.#session().contacts)
          .map(toContact)
          .filter((contact) => contact.id !== ""),
        members,
        marker,
      })
    } catch (error) {
      this.#warn(`the local record did not take this login, so nothing was kept from it: ${reasonOf(error)}`)
    }
  }

  /** One page of contacts out of the store — the same query online and offline. */
  #pageOfContacts(
    cache: CacheStore,
    order: PersonOrder,
    limit: number | undefined,
    offset: number,
    query?: string,
  ): Page<Contact> {
    const items = cache.people.contacts({ order, limit: limit ?? Number.MAX_SAFE_INTEGER, offset, query })
    return { items, hasMore: offset + items.length < cache.people.countContacts({ query }) }
  }

  /**
   * Everyone in the chat except us, or **`undefined` when MAX did not say who is in it**.
   *
   * ⚠ The difference is the whole of it. A delta re-sends a chat because a message arrived and
   * carries no `participants`; read as "nobody is in this chat", that empties the membership and
   * the person on the other side stops being a contact. "Did not say" is not "nobody", and only
   * the first of the two may replace anything.
   */
  #participantsOf(chat: Payload, viewerId: string | undefined): Id[] | undefined {
    const participants = record(chat.participants)
    return participants === undefined ? undefined : Object.keys(participants).filter((id) => id !== viewerId)
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
  /** `interactive: false` and never `CHAT_MARK`: reading history must not mark anything read (§19). */
  async #history(
    chatId: Id,
    window: { from: number; backward: number; forward: number },
    { reactions = true }: { reactions?: boolean } = {},
  ): Promise<Message[]> {
    await this.#connectOnce()
    const session = this.#session()
    const answer = await this.#wire.chats.history({
      chatId,
      ...window,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
      interactive: false,
    })

    const lookup = { names: namesFrom(session.contacts), ...viewer(this.#store) }
    const messages = await this.#nameSenders(asArray(answer.messages).map((raw) => toMessage(raw, chatId, lookup)))
    this.#cache?.messages.write(chatId, messages)
    return reactions ? this.#withReactions(chatId, messages) : messages
  }

  /** One request per page: history carries no reactions (measured 2026-09-23). */
  async #withReactions(chatId: Id, messages: Message[]): Promise<Message[]> {
    if (messages.length === 0) return messages
    try {
      const answer = await this.#wire.messages.reactions({ chatId, messageIds: messages.map((message) => message.id) })
      const byId = record(answer.messagesReactions) ?? {}
      return messages.map((message) => {
        const raw = record(byId[message.id])
        return { ...message, reactions: raw ? toReactions(raw) : { counts: [], mine: null, total: 0 } }
      })
    } catch (error) {
      this.#warn(`reactions are not shown: they could not be read (${reasonOf(error)})`)
      return messages
    }
  }

  /**
   * **A group member who is not a contact arrives as a bare id** — the login names contacts only,
   * so in a group chat everyone but the owner showed as a number (`FIND-45`). The names we hold
   * answer first; the rest cost one `CONTACT_INFO` per hundred, and are kept so the next read
   * does not ask again. Quoted senders in replies and forwards are named the same way.
   *
   * A refused lookup costs the names, not the read: the messages are what was asked for.
   */
  async #nameSenders(messages: Message[]): Promise<Message[]> {
    const quoted = messages.flatMap((message) => [message.replyTo, message.forwardedFrom]).filter(isPresent)
    const ids = [...new Set([...messages, ...quoted].filter(needsName).map((message) => message.senderId as Id))]
    if (ids.length === 0) return messages

    const names = this.#cache?.people.names(ids) ?? new Map<Id, string>()
    const fetched: Contact[] = []
    try {
      for (const batch of batched(
        ids.filter((id) => !names.has(id)),
        CONTACT_INFO_BATCH,
      )) {
        const answer = await this.#wire.contacts.info({ contactIds: batch })
        for (const raw of asArray(answer.contacts)) {
          const contact = toContact(raw)
          if (!contact.id || !contact.name) continue
          names.set(contact.id, contact.name)
          fetched.push(contact)
        }
      }
    } catch (error) {
      this.#warn(`some senders are shown by id: their names could not be looked up (${reasonOf(error)})`)
    }
    if (fetched.length > 0) this.#cache?.people.upsert(fetched, "info")

    const name = <T extends QuotedMessage | Message>(message: T): T =>
      needsName(message) && names.has(message.senderId as Id)
        ? { ...message, senderName: names.get(message.senderId as Id) ?? null }
        : message
    return messages.map((message) => ({
      ...name(message),
      replyTo: message.replyTo && name(message.replyTo),
      forwardedFrom: message.forwardedFrom && name(message.forwardedFrom),
    }))
  }

  /** INIT with the profile's own device, which is the device MAX then issues the token to (bite 8). */
  async #beforeLogin(flow: () => Promise<string>): Promise<string> {
    try {
      await this.#connection.open()
    } catch (error) {
      throw asCliError(error)
    }
    await this.#wire.session.init({ userAgent: WEB_USER_AGENT, deviceId: this.#store.readState().deviceId })
    return await flow()
  }

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
    const started = performance.now()
    const about = { operation: operation.name, opcode: operation.opcode }

    let seq = 0
    let bytes: number | undefined

    let answer: Payload
    try {
      answer = await this.#connection.invoke(operation.opcode, payload, (wire) => {
        seq = wire.seq
        if (wire.phase === "received") {
          bytes = wire.bytes
          return
        }
        this.#emit({ event: "request", ...about, seq, bytes: wire.bytes, ...idsOf(request) })
      })
    } catch (error) {
      const failure = asCliError(error)
      // The request that never came back is the one somebody is reading the log for, so it gets a
      // line of its own rather than disappearing with the exception.
      this.#emit({
        event: "response",
        ...about,
        seq,
        ...(bytes === undefined ? {} : { bytes }),
        durationMs: Math.round(performance.now() - started),
        outcome: "error",
        errorCode: failure.code,
      })
      throw failure
    }

    const counts = countsIn(answer)
    this.#emit({
      event: "response",
      ...about,
      seq,
      ...(bytes === undefined ? {} : { bytes }),
      durationMs: Math.round(performance.now() - started),
      ...(counts ? { counts } : {}),
      outcome: "ok",
    })

    const note = checkResponse(operation, answer)
    if (note) this.#warn(note)
    return answer
  }

  /** A diagnostic that breaks the command it was describing is worse than no diagnostic. */
  #emit(event: DiagnosticEvent): void {
    try {
      this.#events(event)
    } catch {
      // Whoever is keeping the log has a problem; the command does not.
    }
  }

  /**
   * A client id that never repeats within a process.
   *
   * `Date.now()` alone is not enough: two sends in the same millisecond get the same number, and if
   * MAX really does deduplicate by `cid` the second message vanishes with no error anywhere. Caught
   * by a test, not by a lost message. Across processes this is still millisecond-grained, which is
   * safe while one invocation sends one message.
   */
  /**
   * Uploads one file and answers what the message attaches (measured 2026-09-24). An upload is never
   * retried: a failure here happens before `MSG_SEND`, so nothing was sent.
   */
  async #upload({ path, bytes, photo }: { path: string; bytes: Buffer; photo: boolean }): Promise<Payload> {
    const request = { count: 1, type: 0, uploaderType: 0, profile: false } as const
    if (photo) {
      const { url } = await this.#wire.uploads.photo(request)
      if (typeof url !== "string") throw new CliError("provider_error", "MAX gave no address to upload the photo to")
      return { _type: "PHOTO", photoToken: await uploadPhoto(url, path, bytes) }
    }
    const info = record(asArray((await this.#wire.uploads.file(request)).info)[0]) ?? {}
    if (typeof info.url !== "string" || info.fileId === undefined) {
      throw new CliError("provider_error", "MAX gave no address to upload the file to")
    }
    await uploadFile(info.url, path, bytes)
    return { _type: "FILE", fileId: info.fileId }
  }

  /**
   * **A file is processed after its upload**, and a send before that is refused
   * `attachment.not.ready` (measured 2026-09-24). A refusal means nothing was sent, so asking again
   * with the same request — the same `cid` — is safe. Once a second, for up to thirty.
   */
  async #untilAttachmentsReady(send: () => Promise<Payload>): Promise<Payload> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await send()
      } catch (error) {
        if (attempt >= 30 || !asCliError(error).message.includes("attachment.not.ready")) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  /**
   * Every change to a chat, guarded and journalled as a send is. Never retried: none of these is
   * measured to be safe to repeat, and a repeated `create` is a second group.
   */
  async #changeChat<T>(
    chatId: Id | null,
    action: ChatAction,
    act: () => Promise<{ chatId: Id; result: T; people?: number }>,
  ): Promise<T> {
    if (this.#offline)
      throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot change a chat")

    try {
      this.#sends?.check(chatId, "chat", action)
    } catch (error) {
      this.#sends?.record({ chatId, kind: "chat", action, outcome: "refused", errorCode: asCliError(error).code })
      throw error
    }

    try {
      await this.#connectOnce()
      const done = await act()
      this.#sends?.record({
        chatId: done.chatId,
        kind: "chat",
        action,
        outcome: "sent",
        ...(done.people === undefined ? {} : { people: done.people }),
      })
      return done.result
    } catch (error) {
      const failure = asCliError(error)
      this.#sends?.record({
        chatId,
        kind: "chat",
        action,
        outcome: failure.code === "outcome_unknown" ? "outcome_unknown" : "failed",
        errorCode: failure.code,
      })
      throw error
    }
  }

  async #updateMembers(
    reference: string,
    people: string[],
    action: ChatAction,
    change: Omit<RequestOf<typeof chatsUpdateMembers>, "chatId" | "userIds">,
  ): Promise<ChatChange> {
    const chatId = await this.chats.resolve(reference)
    return this.#changeChat(chatId, action, async () => {
      const userIds = await this.#personIds(people)
      const answer = await this.#wire.chats.updateMembers({ chatId, userIds, ...change })
      const chat = record(answer.chat)
      return {
        chatId,
        people: userIds.length,
        result: { chatId, action, people: userIds, chat: chat ? toGroupCard(chat) : null },
      }
    })
  }

  /** An id goes as given; a name is looked up in the store, and an ambiguous one is refused. */
  async #personIds(references: string[]): Promise<Id[]> {
    if (references.every(isId)) return references.map((reference) => reference.trim())

    const cache = this.#cache
    if (!cache) {
      throw new CliError(
        "configuration_error",
        `there is no local store for profile "${this.#store.profile}" to look names up in — give people by id`,
      )
    }
    await this.#connectOnce()
    await this.#peopleFor(asArray(this.#session().chats))
    return references.map((reference) => (isId(reference) ? reference.trim() : pickPerson(reference, cache).id))
  }

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

    const viewerId = this.#store.readState().viewerId
    const missing = new Set<Id>()
    for (const chat of chats) {
      if (toChat(chat).kind === "channel") continue
      for (const id of this.#participantsOf(chat, viewerId) ?? []) if (!people.has(id)) missing.add(id)
    }

    const named: Contact[] = []
    for (const batch of batched([...missing], CONTACT_INFO_BATCH)) {
      const answer = await this.#wire.contacts.info({ contactIds: batch })
      for (const raw of asArray(answer.contacts)) {
        const contact = toContact(raw)
        if (!contact.id) continue
        people.set(contact.id, contact)
        named.push(contact)
      }
    }

    // Written here rather than left in memory: the process ends in a moment, and the next one
    // should not pay for these names again.
    //
    // ⚠ **And the order is recomputed after**, not before. These people did not exist when the
    // login's chats were written, so the recency that was set then reached only the handful the
    // login itself named — 6 of 22 on the real account, with every other dialog partner sorting
    // as never-messaged.
    if (named.length > 0) {
      this.#cache?.people.upsert(named, "info")
      this.#cache?.people.refreshRecency()
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

  /**
   * A change to the account itself, not to a chat: a read-only profile refuses it, no recipient
   * list applies, it does not count towards the hourly limit, and the journal records which kind
   * of change it was. **Never retried** — at worst the command is typed again.
   */
  async #change<T>(action: AccountAction, body: () => Promise<T>): Promise<T> {
    if (this.#offline)
      throw new CliError("validation_error", "`--offline` reads what was recorded; it cannot change the account")

    try {
      this.#sends?.check(null, "account")
    } catch (error) {
      this.#sends?.record({
        chatId: null,
        kind: "account",
        action,
        outcome: "refused",
        errorCode: asCliError(error).code,
      })
      throw error
    }

    try {
      await this.#connectOnce()
      const result = await body()
      this.#sends?.record({ chatId: null, kind: "account", action, outcome: "sent" })
      return result
    } catch (error) {
      this.#sends?.record({
        chatId: null,
        kind: "account",
        action,
        outcome: "failed",
        errorCode: asCliError(error).code,
      })
      throw error
    }
  }

  #contactAction(action: AccountAction, wire: "ADD" | "REMOVE", reference: string): Promise<Contact> {
    return this.#change(action, async () => {
      const cache = this.#cache
      const known = isId(reference) ? cache?.people.get(reference.trim()) : undefined
      if (!isId(reference) && !cache) {
        throw new CliError(
          "validation_error",
          "without a local store a person is named by id — `max contacts lookup` finds one",
        )
      }
      const id = isId(reference) ? reference.trim() : pickPerson(reference, cache as CacheStore).id

      const answer = await this.#wire.contacts.update({ contactId: id, action: wire })
      const contact = record(answer.contact)
      if (contact) return this.#remember(toContact(contact))
      return known ?? { id, name: null, username: null, description: null, lastMessagedAt: null }
    })
  }

  #remember(contact: Contact): Contact {
    if (contact.id !== "") this.#cache?.people.upsert([contact], "info")
    return contact
  }

  async #folders(): Promise<Payload[]> {
    if (this.#offline)
      throw new CliError("validation_error", "`--offline` reads what was recorded, and folders are not recorded")
    await this.#connectOnce()
    const answer = await this.#wire.folders.list({ folderSync: 0 })
    const folders = asArray(answer.folders)
    const order = Array.isArray(answer.foldersOrder) ? answer.foldersOrder.map(String) : []
    const rank = (folder: Payload) => {
      const at = order.indexOf(String(folder.id))
      return at === -1 ? order.length : at
    }
    return [...folders].sort((a, b) => rank(a) - rank(b))
  }

  #session(): Payload {
    if (!this.#login) throw new CliError("configuration_error", "connect() was never called")
    return this.#login
  }
}

/** What a change to a chat answers when MAX sends back no chat of its own. */
export interface ChatChange {
  chatId: Id
  action: ChatAction
  people: Id[]
  chat: GroupCard | null
}

export type AdminRight = "members" | "admins" | "info" | "pin" | "post" | "edit" | "delete"

/** PyMax `AdminPermission`; the sum is what MAX takes. */
export const ADMIN_RIGHTS: Record<AdminRight, number> = {
  members: 2,
  admins: 4,
  info: 8,
  pin: 16,
  post: 256,
  edit: 512,
  delete: 1024,
}

/** PyMax asks for this many; paging join requests is not known. */
const JOIN_REQUESTS = 100

/**
 * A private link goes as `join/<token>`, whatever came before it, as PyMax sends it and as
 * measured. A public one (`https://max.ru/<name>`) goes whole, which is PyMax's claim only.
 */
export const wireLink = (link: string): string => {
  const trimmed = link.trim()
  const at = trimmed.indexOf("join/")
  if (at >= 0 && trimmed.length > at + "join/".length) return trimmed.slice(at)
  if (/^(https:\/\/)?max\.ru\/[\w.-]+\/?$/.test(trimmed)) return trimmed
  throw new CliError("validation_error", "not a MAX link — expected https://max.ru/join/… or https://max.ru/<name>")
}

const largestMp4 = (answer: Payload): string | undefined =>
  Object.entries(answer)
    .map(([key, value]) => ({ height: /^MP4_(\d+)$/.exec(key)?.[1], value }))
    .filter(
      (entry): entry is { height: string; value: string } =>
        entry.height !== undefined && typeof entry.value === "string",
    )
    .sort((a, b) => Number(b.height) - Number(a.height))[0]?.value

/** What every listing takes. Absent means "the caller did not say", never a number chosen here. */
export interface PageRequest {
  order?: PersonOrder
  limit?: number
  offset?: number
  /** Part of a name. Refused below three characters — see `checkedQuery`. */
  query?: string
  kind?: ChatKind
  /** Only chats MAX counts unread messages in; a chat where it did not say is not one of them. */
  unread?: boolean
}

/**
 * **The shortest search the index can answer is three characters**, and below that it returns
 * nothing rather than complaining (measured 2026-09-22). An empty list reads as "no matches",
 * so this refuses instead — the one answer that is never mistaken for a result.
 *
 * It is checked here rather than in each command, and on every path rather than only where a
 * store exists: a filter that works with a cache and not without it would make the answer depend
 * on something the person never asked about.
 */
const MIN_QUERY = 3

const checkedQuery = (query: string | undefined): string | undefined => {
  if (query === undefined) return undefined
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY) {
    throw new CliError(
      "validation_error",
      `a search needs at least ${MIN_QUERY} characters — "${trimmed}" is ${trimmed.length}`,
    )
  }
  return trimmed
}

/**
 * **One `CONTACT_INFO` for a hundred people.** The bound is unmeasured; the comparable one is
 * `chatsCount`, where 100 is accepted and 200 comes back out of range (`PROTO-3`). Somebody in
 * forty groups is the case that will find the real number, and it will find it as a refusal that
 * names itself rather than as a wrong answer.
 */
const CONTACT_INFO_BATCH = 100

/**
 * When a message was sent, read from its id: **`id >> 16` is the send time in milliseconds**, the
 * low 16 bits a counter. Measured 2026-09-22 on three messages across two days, exact every time.
 * `undefined` for anything that is not a message id.
 */
export const timeOfMessageId = (id: Id): number | undefined => {
  if (!/^\d{10,20}$/.test(id)) return undefined
  const time = Number(BigInt(id) >> 16n)
  return Number.isSafeInteger(time) && time > 0 ? time : undefined
}

/**
 * **At most this many history reads per `max inbox`.** The official client reads a chat's history
 * when a person opens it; twenty in one burst is already more than a person does (§34). A personal
 * account rarely has that many chats change between two checks, and the rest are named, not lost.
 */
const INBOX_CHATS = 20

/** Newest first — the chats a reader most likely came for are read before the cap. */
const byRecency = (chats: Chat[]): Chat[] =>
  chats.toSorted((a, b) => Date.parse(b.lastMessageAt ?? "") - Date.parse(a.lastMessageAt ?? ""))

const capped = (chats: Chat[]) => ({
  read: chats.slice(0, INBOX_CHATS),
  skipped: chats.slice(INBOX_CHATS).map(({ id, title, lastMessageAt }) => ({ id, title, lastMessageAt })),
})

const isPresent = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined

const needsName = (message: Pick<Message, "senderId" | "senderName" | "outgoing">): boolean =>
  message.senderId !== null && message.senderName === null && message.outgoing !== true

const batched = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = []
  for (let at = 0; at < items.length; at += size) batches.push(items.slice(at, at + size))
  return batches
}

/** Paging over a list already in hand — the fallback for when there is no store to page in SQL. */
/**
 * The same filter as the store's, for the path where no store opened.
 *
 * ⚠ **This is a second implementation of one promise, and that is a cost paid knowingly.** The
 * store asks a trigram index; here there is nothing to ask, so it is `includes` over a lowered
 * string. For a needle of three characters or more the two agree — a trigram match *is* a
 * substring match — and where they could drift is an alphabet whose lowercase form differs
 * between SQLite's folding and JavaScript's. Nobody has hit that; if somebody does, the fix is
 * this function, not the index.
 *
 * The alternative was to let a filter only work when a cache happened to exist, which makes the
 * answer depend on something the person never asked about.
 */
const matching = (chats: Chat[], { query, kind, unread }: Pick<PageRequest, "query" | "kind" | "unread">): Chat[] => {
  const needle = query?.toLocaleLowerCase()
  return chats.filter(
    (chat) =>
      (kind === undefined || chat.kind === kind) &&
      (!unread || (chat.unreadCount ?? 0) > 0) &&
      (needle === undefined || (chat.title ?? "").toLocaleLowerCase().includes(needle)),
  )
}

/** As `matching`, over the two columns `people_fts` indexes. */
const matchingPeople = (people: Contact[], query: string | undefined): Contact[] => {
  if (query === undefined) return people
  const needle = query.toLocaleLowerCase()
  return people.filter((person) => `${person.name ?? ""} ${person.username ?? ""}`.toLocaleLowerCase().includes(needle))
}

const paged = <T>(items: T[], limit: number | undefined, offset: number): Page<T> => {
  const page = limit === undefined ? items.slice(offset) : items.slice(offset, offset + limit)
  return { items: page, hasMore: offset + page.length < items.length }
}

/** `--offline` was asked for explicitly, so age is not a reason to refuse what was recorded. */
const ANY_AGE = Number.POSITIVE_INFINITY

/**
 * The marker only means anything if MAX gave us one. A login without a `time` is not a reason to
 * store `0` — that would tell the next login to send everything, which is exactly what a stored
 * marker exists to stop.
 */
const asMarker = (time: unknown): number | undefined =>
  typeof time === "number" && Number.isFinite(time) && time > 0 ? time : undefined

/** The reason, never the payload: a store's failure is a code, and the rows are people's names. */
const reasonOf = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code
  return typeof code === "string" ? code : error instanceof Error ? error.name : "an unknown problem"
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

export interface ProfileChange {
  firstName?: string
  lastName?: string
  description?: string
}

export interface FolderChange {
  title?: string
  add?: string[]
  remove?: string[]
}

export interface PhoneBookEntry {
  phone: string
  name: string
}

const ownNames = (profile: Payload): { firstName?: string; lastName?: string } => {
  const contact = record(profile.contact) ?? profile
  const names = asArray(contact.names)
  const own = names.find((entry) => entry.type === "ONEME") ?? names[0]
  return {
    ...(typeof own?.firstName === "string" && own.firstName !== "" ? { firstName: own.firstName } : {}),
    ...(typeof own?.lastName === "string" ? { lastName: own.lastName } : {}),
  }
}

/** `+` and digits, as the lookup was measured. ⚠ The refusal never repeats what was typed. */
const wirePhone = (typed: string): string => {
  const digits = typed.replace(/[\s()-]/g, "").replace(/^\+/, "")
  if (!/^\d{7,15}$/.test(digits)) {
    throw new CliError("validation_error", "a phone number is 7 to 15 digits, with an optional + and the country code")
  }
  return `+${digits}`
}

/** 21 characters were refused as too long and 15 were taken (measured 2026-09-24); MAX draws the line. */
const folderTitle = (title: string): string => {
  const trimmed = title.trim()
  if (trimmed === "") throw new CliError("validation_error", "a folder needs a title")
  return trimmed
}

const pickFolder = (reference: string, folders: Payload[]): Payload => {
  const wanted = reference.trim()
  const byId = folders.find((folder) => folder.id === wanted)
  if (byId) return byId
  const named = folders.filter((folder) => typeof folder.title === "string" && folder.title === wanted)
  if (named.length === 1 && named[0]) return named[0]
  if (named.length > 1) {
    throw new CliError(
      "validation_error",
      `${named.length} folders are called "${wanted}" — name one by id (\`max chats folders list\`)`,
    )
  }
  throw new CliError("not_found", `no folder "${wanted}" — \`max chats folders list\` shows them`)
}
