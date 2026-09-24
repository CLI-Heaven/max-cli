import { describe, expect, it } from "vitest"
import { namesFrom, toChat, toMessage, toProfile } from "./map.js"

/**
 * Field names are from a real MAX response, observed 2026-09-19; every **value** here is invented.
 * Nothing in this file came off a real account — a real account id did reach this file once, and
 * the phone rule in `.gitleaks.toml` is what stopped the commit that carried it.
 */
const chatWire = {
  id: 7268926000000000001n,
  title: "Synthetic group",
  type: "CHAT",
  lastEventTime: 1789776000000,
  participantsCount: 3,
  messagesCount: 42,
  owner: 100000001,
  status: "ACTIVE",
  access: "PUBLIC",
  somethingMaxAddedLastWeek: { nobody: "knows" },
}

describe("toChat", () => {
  it("keeps a 64-bit id exact and as a string", () => {
    expect(toChat(chatWire).id).toBe("7268926000000000001")
  })

  it("translates MAX's type into ours — CHAT is a group, not a dialog", () => {
    expect(toChat(chatWire).kind).toBe("group")
    expect(toChat({ ...chatWire, type: "DIALOG" }).kind).toBe("dialog")
    expect(toChat({ ...chatWire, type: "CHANNEL" }).kind).toBe("channel")
  })

  it("says `unknown` rather than guessing at a type it has never seen", () => {
    expect(toChat({ ...chatWire, type: "SOMETHING_NEW" }).kind).toBe("unknown")
  })

  it("turns Unix milliseconds into ISO 8601", () => {
    expect(toChat(chatWire).lastMessageAt).toBe("2026-09-19T00:00:00.000Z")
  })

  it("distinguishes 'no unread' from 'MAX did not say'", () => {
    expect(toChat(chatWire).unreadCount).toBeNull()
    expect(toChat({ ...chatWire, newMessages: 0 }).unreadCount).toBe(0)
    expect(toChat({ ...chatWire, newMessages: 12 }).unreadCount).toBe(12)
  })

  it("ignores a field MAX added without telling anyone", () => {
    expect(Object.keys(toChat(chatWire))).toEqual([
      "id",
      "title",
      "kind",
      "unreadCount",
      "lastMessageAt",
      "participantsCount",
    ])
  })

  it("survives a chat with almost nothing in it", () => {
    expect(toChat({ id: 5 })).toEqual({
      id: "5",
      title: null,
      kind: "unknown",
      unreadCount: null,
      lastMessageAt: null,
      participantsCount: null,
    })
  })
})

const messageWire = {
  id: 116762160362694583n,
  time: 1789776000000,
  type: "USER",
  sender: 3260455,
  cid: 35,
  text: "hello",
  elements: [],
  attaches: [
    { _type: "PHOTO", photoId: 1, baseUrl: "https://i.example/p1", width: 800, height: 600, photoToken: "t" },
    { _type: "SHARE", url: "https://example.com/a", title: "A page" },
    { _type: "FILE" },
  ],
  reactionInfo: {},
}

describe("toMessage", () => {
  it("carries the ids, the text and the time", () => {
    const message = toMessage(messageWire, "7268926")
    expect(message.id).toBe("116762160362694583")
    expect(message.chatId).toBe("7268926")
    expect(message.senderId).toBe("3260455")
    expect(message.text).toBe("hello")
    expect(message.timestamp).toBe("2026-09-19T00:00:00.000Z")
  })

  it("knows which messages are ours, and admits when it cannot tell", () => {
    expect(toMessage(messageWire, "7268926", { viewerId: "3260455" }).outgoing).toBe(true)
    expect(toMessage(messageWire, "7268926", { viewerId: "999" }).outgoing).toBe(false)
    expect(toMessage(messageWire, "7268926").outgoing).toBeNull()
  })

  it("names the sender when the login response said who that is", () => {
    const names = new Map([["3260455", "Ivan Petrov"]])
    expect(toMessage(messageWire, "7268926", { names }).senderName).toBe("Ivan Petrov")
    expect(toMessage(messageWire, "7268926").senderName).toBeNull()
  })

  it("reports attachments by kind with their link and size, and nothing else of the wire", () => {
    expect(toMessage(messageWire, "7268926").attachments).toEqual([
      { kind: "photo", url: "https://i.example/p1", width: 800, height: 600 },
      { kind: "share", url: "https://example.com/a", title: "A page" },
      { kind: "file" },
    ])
  })

  it("carries the message a reply answers and a forward carries, named when the login named its sender", () => {
    const quoted = { id: 9, sender: 3260455, text: "the question", time: 1789776000000, attaches: [{ _type: "PHOTO" }] }
    const names = new Map([["3260455", "Ivan Petrov"]])
    const reply = toMessage({ ...messageWire, link: { type: "REPLY", chatId: 1, message: quoted } }, "7268926", {
      names,
    })
    const forward = toMessage({ ...messageWire, link: { type: "FORWARD", chatId: 1, message: quoted } }, "7268926")

    expect(reply.replyTo).toEqual({
      id: "9",
      senderId: "3260455",
      senderName: "Ivan Petrov",
      timestamp: new Date(1789776000000).toISOString(),
      text: "the question",
      attachments: [{ kind: "photo" }],
      outgoing: null,
    })
    expect(reply.forwardedFrom).toBeNull()
    expect(forward.forwardedFrom?.id).toBe("9")
    expect(forward.replyTo).toBeNull()
    expect(toMessage(messageWire, "7268926").replyTo).toBeNull()
  })

  it("does not lose a message because it has no text", () => {
    const empty = toMessage({ id: 1, time: 1789776000000, sender: 2 }, "7268926")
    expect(empty.text).toBe("")
    expect(empty.attachments).toEqual([])
  })

  it("treats a channel post with no sender as senderless rather than failing", () => {
    expect(toMessage({ ...messageWire, sender: null }, "7268926").senderId).toBeNull()
  })
})

describe("toProfile", () => {
  it("reads the shape the login response actually uses", () => {
    const profile = toProfile({
      contact: {
        id: 10000001,
        names: [
          { name: "Full Name", type: "FULL_NAME" },
          { name: "Nick", type: "NICK" },
        ],
        phones: [{ number: "+71234567890", type: "MOBILE" }],
      },
    })

    expect(profile).toEqual({ id: "10000001", name: "Full Name", phone: "+71234567890", description: null })
  })

  it("prefers the full name but accepts any name over none", () => {
    expect(toProfile({ contact: { id: 1, names: [{ name: "Only", type: "NICK" }] } }).name).toBe("Only")
  })

  it("survives a profile with no name and no phone", () => {
    expect(toProfile({ contact: { id: 1 } })).toEqual({ id: "1", name: null, phone: null, description: null })
  })
})

describe("namesFrom", () => {
  it("builds a lookup out of the contacts a login carries", () => {
    const names = namesFrom([
      { id: 1, names: [{ name: "One", type: "FULL_NAME" }] },
      { id: 2, names: [{ name: "Two", type: "FULL_NAME" }] },
      { id: 3 },
      "not a contact",
    ])

    expect(names.get("1")).toBe("One")
    expect(names.size).toBe(2)
  })

  it("is empty rather than broken when there are no contacts", () => {
    expect(namesFrom(undefined).size).toBe(0)
  })
})
