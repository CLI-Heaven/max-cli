import stringWidth from "string-width"
import { describe, expect, it } from "vitest"
import type { Message, QuotedMessage } from "../domain/models.js"
import { type RenderOptions, renderMessage, renderMessages } from "./messages.js"

const message = (over: Partial<Message> = {}): Message => ({
  id: "100000000000000001",
  chatId: "-1000",
  senderId: "111",
  senderName: "Анна",
  timestamp: "2026-01-03T09:05:12.000Z",
  editedAt: null,
  text: "созвонимся в четверг?",
  outgoing: false,
  attachments: [],
  replyTo: null,
  forwardedFrom: null,
  ...over,
})

const quoted = (over: Partial<QuotedMessage> = {}): QuotedMessage => ({
  id: "100000000000000003",
  senderId: "333",
  senderName: null,
  timestamp: "2026-01-03T09:09:03.000Z",
  text: "Пришлю ссылку утром.",
  attachments: [],
  outgoing: false,
  ...over,
})

const plain: RenderOptions = { timeZone: "Europe/Madrid", width: 60 }
const ESC = "\u001b"

describe("a message, as a person reads it", () => {
  it("puts time and sender on one line and the text under them", () => {
    expect(renderMessage(message(), plain)).toBe("10:05:12  Анна\n          созвонимся в четверг?")
  })

  it("keeps line breaks, each line aligned with the text", () => {
    expect(
      renderMessage(message({ text: "Договорились.\nПришлю ссылку утром." }), plain)
        .split("\n")
        .slice(1),
    ).toEqual(["          Договорились.", "          Пришлю ссылку утром."])
  })

  it("wraps a long message inside the width, continuation aligned, nothing cut", () => {
    const text = "слово ".repeat(40).trim()
    const lines = renderMessage(message({ text }), plain).split("\n").slice(1)
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(60)
      expect(line.startsWith("          ")).toBe(true)
    }
    expect(lines.join(" ").replace(/\s+/g, " ").trim()).toBe(text)
  })

  it("measures wide characters by the columns they take, not by their length", () => {
    for (const name of ["Анна", "张伟", "👨‍💻 Alex"]) {
      const lines = renderMessage(message({ senderName: name, text: "你好 ".repeat(30).trim() }), plain).split("\n")
      expect(lines[0]).toBe(`10:05:12  ${name}`)
      for (const line of lines.slice(1)) expect(stringWidth(line)).toBeLessThanOrEqual(60)
    }
  })

  it("keeps an emoji in the text intact", () => {
    expect(renderMessage(message({ text: "готово ✅✅" }), plain)).toContain("готово ✅✅")
  })

  it("says вы for this account and the id for a sender nobody named", () => {
    expect(renderMessage(message({ outgoing: true }), plain).split("\n")[0]).toBe("10:05:12  вы")
    expect(renderMessage(message({ senderName: null, senderId: "222" }), plain).split("\n")[0]).toBe("10:05:12  222")
  })

  it("shows the edit time alone on the same day, and the date too on another", () => {
    expect(renderMessage(message({ editedAt: "2026-01-03T09:09:30.000Z" }), plain)).toContain("edited 10:09:30")
    expect(renderMessage(message({ editedAt: "2026-01-05T08:00:00.000Z" }), plain)).toContain(
      "edited 5 января 2026 09:00:00",
    )
  })

  it("lists attachments compactly, grouping the same kind, with the address when there is no colour", () => {
    const out = renderMessage(
      message({
        attachments: [
          { kind: "photo", url: "https://i.example/1" },
          { kind: "photo", url: "https://i.example/2" },
          { kind: "file", name: "report.pdf", size: 24_000_000 },
        ],
      }),
      plain,
    )
    expect(out).toContain("📎 photo ×2 1 https://i.example/1 2 https://i.example/2")
    expect(out).toContain("📎 report.pdf · 24 MB")
  })

  it("makes an attachment a hyperlink when there is colour", () => {
    const out = renderMessage(message({ attachments: [{ kind: "photo", url: "https://i.example/1" }] }), {
      ...plain,
      color: true,
    })
    expect(out).toContain(`${ESC}]8;;https://i.example/1\u0007photo${ESC}]8;;\u0007`)
  })

  it("previews what a reply answers in one line, and names the message when there is nothing to show", () => {
    const reply = renderMessage(message({ replyTo: quoted({ outgoing: true }) }), plain).split("\n")
    expect(reply[1]).toBe("          ↳ вы: Пришлю ссылку утром.")

    const long = renderMessage(message({ replyTo: quoted({ text: "очень ".repeat(30) }) }), plain).split("\n")[1] ?? ""
    expect(stringWidth(long)).toBeLessThanOrEqual(60)
    expect(long.endsWith("…")).toBe(true)

    const empty = renderMessage(message({ replyTo: quoted({ text: "" }) }), plain)
    expect(empty).toContain("↳ message 100000000000000003")
  })

  it("shows a forward with its author and its text", () => {
    const out = renderMessage(message({ text: "", forwardedFrom: quoted({ senderName: "Миша" }) }), plain)
    expect(out.split("\n").slice(1)).toEqual(["          ↪ Миша", "          Пришлю ссылку утром."])
  })

  it("still reads at 40 columns, and a narrower terminal is treated as 40", () => {
    const text = "слово ".repeat(20).trim()
    for (const line of renderMessage(message({ text }), { ...plain, width: 20 }).split("\n"))
      expect(stringWidth(line)).toBeLessThanOrEqual(40)
  })
})

describe("how much is shown", () => {
  it("adds the ids with -v", () => {
    const out = renderMessage(message({ attachments: [{ kind: "photo", url: "https://i.example/1" }] }), {
      ...plain,
      verbosity: 1,
    })
    expect(out).toContain("message  100000000000000001")
    expect(out).toContain("sender   111")
    expect(out).toContain("chat     -1000")
    expect(out).toContain("link     https://i.example/1")
    expect(out).not.toContain("provider")
  })

  it("adds what the provider knows with -vv", () => {
    const out = renderMessage(message(), { ...plain, verbosity: 2, profile: "default" })
    expect(out).toContain("provider  max")
    expect(out).toContain("profile   default")
    expect(out).toContain("sent      2026-01-03T09:05:12.000Z")
  })

  it("writes no escape code at all without colour, even with sender colours asked for", () => {
    expect(renderMessages([message(), message({ outgoing: true })], { ...plain, senderColors: true })).not.toContain(
      ESC,
    )
  })

  it("styles вы in bold cyan, and with sender colours keeps cyan for вы alone", () => {
    const colour = { ...plain, color: true, senderColors: true }
    expect(renderMessage(message({ outgoing: true }), colour)).toContain(`${ESC}[36m`)
    for (const id of ["1", "2", "3", "4", "5", "6", "7"])
      expect(renderMessage(message({ senderId: id }), colour).split("\n")[0]).not.toContain(`${ESC}[36m`)
  })
})

describe("a conversation", () => {
  it("marks the message a window was taken around", () => {
    const out = renderMessages([message(), { ...message({ id: "2" }), anchor: true as const }], plain)
    expect(out.split("\n").filter((line) => line.endsWith("◀"))).toEqual(["10:05:12  Анна  ◀"])
  })

  it("separates the days, and only where the date changes", () => {
    const out = renderMessages(
      [
        message(),
        message({ id: "2", timestamp: "2026-01-03T09:07:40.000Z" }),
        message({ id: "3", timestamp: "2026-01-04T10:00:00.000Z" }),
      ],
      plain,
    )
    expect(out.match(/── /g)).toHaveLength(2)
    expect(out.startsWith("── 3 января 2026 ──\n\n10:05:12  Анна")).toBe(true)
    expect(out).toContain("── 4 января 2026 ──")
  })
})
