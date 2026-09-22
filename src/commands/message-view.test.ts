import { describe, expect, it } from "vitest"
import type { Message } from "../domain/models.js"
import { renderMessages } from "./message-view.js"

const message = (over: Partial<Message> = {}): Message => ({
  id: "100000000000000001",
  chatId: "-1000",
  senderId: "111",
  senderName: "Anna",
  timestamp: "2026-01-03T09:05:12.000Z",
  editedAt: null,
  text: "call on Thursday?",
  outgoing: false,
  attachments: [],
  ...over,
})

const plain = { color: false, timeZone: "Europe/Madrid" }

describe("the message feed a person reads", () => {
  it("puts local time, author and text on one line and the ids on the next", () => {
    expect(renderMessages([message()], plain)).toBe(
      "[03.01.26 10:05:12] Anna: call on Thursday?\n  messageId=100000000000000001 chatId=-1000 senderId=111",
    )
  })

  it("names an unnamed sender by quoted id, and this account as you", () => {
    const out = renderMessages([message({ senderName: null }), message({ outgoing: true, senderName: null })], plain)
    expect(out).toContain('] "111": call')
    expect(out).toContain("] you: call")
  })

  it("indents continuation lines so a line starting with [ is always a new message", () => {
    const out = renderMessages([message({ text: "first\nsecond" })], plain)
    expect(out.split("\n")[1]).toBe("  second")
  })

  it("wraps at the width without breaking the author off its time", () => {
    const long = "word ".repeat(30).trim()
    const lines = renderMessages([message({ text: long })], { ...plain, width: 50 }).split("\n")
    expect(lines[0]?.startsWith("[03.01.26 10:05:12] Anna: word")).toBe(true)
    for (const line of lines.filter((l) => !l.includes("messageId="))) expect(line.length).toBeLessThanOrEqual(50)
  })

  it("marks an edit and lists attachments, links whole and last, only when there are any", () => {
    const out = renderMessages(
      [
        message({
          editedAt: "2026-01-03T09:09:30.000Z",
          attachments: [{ kind: "photo", width: 800, height: 600, url: "https://i.example/p1" }],
        }),
        message({ id: "2" }),
      ],
      plain,
    )
    expect(out).toContain("edited=03.01.26 10:09:30")
    expect(out).toContain("  attachment: photo 800×600 https://i.example/p1")
    expect(out.split("\n\n")[1]).not.toContain("attachment")
  })

  it("prints the chat once when the whole feed is one chat", () => {
    const out = renderMessages([message(), message({ id: "2" })], { ...plain, chatId: "-1000" })
    expect(out.startsWith("chatId=-1000\n\n")).toBe(true)
    expect(out.match(/chatId=/g)).toHaveLength(1)
  })

  it("writes no escape code at all without colour", () => {
    expect(renderMessages([message()], { ...plain, senderColors: true })).not.toContain("\u001b")
  })

  it("gives one sender one colour, and this account a colour no sender gets", () => {
    const colours = { color: true, senderColors: true, timeZone: "UTC" }
    const colourOf = (m: Message) => renderMessages([m], colours).match(new RegExp(`${"\u001b"}\\[1;(\\d+)m`))?.[1]
    expect(colourOf(message())).toBe(colourOf(message({ id: "2", text: "other" })))
    expect(colourOf(message({ outgoing: true }))).toBe("32")
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8"])
      expect(colourOf(message({ senderId: id }))).not.toBe("32")
  })
})
