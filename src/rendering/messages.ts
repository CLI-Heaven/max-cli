import { styleText } from "node:util"
import { visibleControls } from "@leemour/cli-core"
import stringWidth from "string-width"
import wrapAnsi from "wrap-ansi"
import type { Attachment, Message, MessageHit, QuotedMessage, Reactions, WindowedMessage } from "../domain/models.js"

export interface RenderOptions {
  /** 0 — the conversation; 1 — the ids worth searching by; 2 — everything the model knows. */
  verbosity?: 0 | 1 | 2
  width?: number
  /**
   * Whether to style at all. **Decided by the caller**: `styleText` checks the stream under Node and
   * not under Bun, which styles a pipe too (measured 2026-09-22).
   */
  color?: boolean
  /** A colour per sender, `вы` keeping cyan to itself. */
  senderColors?: boolean
  locale?: string
  timeZone?: string
  profile?: string
}

type Style = Parameters<typeof styleText>[0]

const TIME_WIDTH = 8
const INDENT = " ".repeat(TIME_WIDTH + 2)
const MIN_WIDTH = 40
const SENDER_COLOURS = ["green", "yellow", "magenta", "blue", "red"] as const

export const renderMessages = (
  messages: (Message | MessageHit | WindowedMessage)[],
  options: RenderOptions = {},
): string => {
  if (messages.length === 0) return "(nothing)"
  const day = dayFormatter(options)
  const paint = painter(options)

  let previous: string | undefined
  const blocks: string[] = []
  for (const message of messages) {
    const date = day(message.timestamp)
    if (date !== previous) blocks.push(paint("dim", `── ${date} ──`))
    previous = date
    blocks.push(renderMessage(message, options))
  }
  return blocks.join("\n\n")
}

export const renderMessage = (message: Message | MessageHit | WindowedMessage, options: RenderOptions = {}): string => {
  const paint = painter(options)
  const width = Math.max(MIN_WIDTH, options.width ?? 80)
  const room = width - INDENT.length
  const time = timeFormatter(options)
  const verbosity = options.verbosity ?? 0

  const chat = "chatTitle" in message ? paint("dim", ` · ${visibleControls(message.chatTitle ?? message.chatId)}`) : ""
  const mark = "anchor" in message && message.anchor ? paint("bold", "  ◀") : ""
  const lines = [`${paint("dim", time(message.timestamp))}  ${senderOf(message, options)}${chat}${mark}`]
  const body = (text: string) => wrapAnsi(visibleControls(text), room, { hard: true }).split("\n")

  if (message.replyTo) lines.push(paint("dim", preview("↳", message.replyTo, room)))
  if (message.forwardedFrom) {
    lines.push(paint("dim", `↪ ${nameOf(message.forwardedFrom)}`))
    if (message.forwardedFrom.text) lines.push(...body(message.forwardedFrom.text))
    lines.push(...attachmentLines(message.forwardedFrom.attachments, paint, options))
  }
  if (message.text) lines.push(...body(message.text))
  lines.push(...attachmentLines(message.attachments, paint, options))
  if (message.reactions && message.reactions.total > 0) lines.push(paint("dim", reactionLine(message.reactions)))
  if (message.editedAt) lines.push(paint("dim", `edited ${editedAt(message, options)}`))

  if (verbosity >= 1) {
    const fields: [string, string | null | undefined][] = [
      ["message", message.id],
      ["sender", message.senderId],
      ["chat", message.chatId],
      ["reply to", message.replyTo?.id],
      ["forward of", message.forwardedFrom?.id],
      ...message.attachments.map((a): [string, string | undefined] => ["link", a.url]),
    ]
    if (verbosity >= 2) {
      fields.push(
        ["provider", "max"],
        ["profile", options.profile],
        ["sent", message.timestamp],
        ["edited", message.editedAt],
        ["outgoing", message.outgoing === null ? "unknown" : String(message.outgoing)],
        ...message.attachments.map((a): [string, string] => ["attachment", JSON.stringify(a)]),
      )
    }
    const shown = fields.filter((field): field is [string, string] => typeof field[1] === "string")
    const label = Math.max(...shown.map(([key]) => key.length))
    lines.push("", ...shown.map(([key, value]) => paint("dim", `${key.padEnd(label)}  ${visibleControls(value)}`)))
  }

  return lines.map((line, index) => (index === 0 || line === "" ? line : `${INDENT}${line}`)).join("\n")
}

const painter =
  ({ color = false }: RenderOptions) =>
  (style: Style, text: string): string =>
    color ? styleText(style, text, { validateStream: false }) : text

const senderOf = (message: Message, options: RenderOptions): string => {
  const paint = painter(options)
  if (message.outgoing === true) return paint(["bold", "cyan"], "вы")
  const name = nameOf(message)
  if (!options.senderColors) return paint("bold", name)
  const colour = SENDER_COLOURS[hash(message.senderId ?? name) % SENDER_COLOURS.length] ?? "green"
  return paint(["bold", colour], name)
}

const nameOf = ({ senderName, senderId, outgoing }: Pick<Message, "senderName" | "senderId" | "outgoing">): string =>
  outgoing === true ? "вы" : visibleControls(senderName ?? senderId ?? "unknown")

const hash = (value: string): number => [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)

/** One line: it is a pointer to the other message, not a second copy of it. */
const preview = (mark: string, quoted: QuotedMessage, room: number): string => {
  const text =
    visibleControls(quoted.text.split("\n")[0] ?? "") ||
    (quoted.attachments[0] ? `📎 ${quoted.attachments[0].kind}` : "")
  const line = text ? `${mark} ${nameOf(quoted)}: ${text}` : `${mark} message ${quoted.id}`
  if (stringWidth(line) <= room) return line
  return `${wrapAnsi(line, room - 1, { hard: true }).split("\n")[0]}…`
}

/**
 * Compact, and each one a link: `📎 photo`, `📎 photo ×3 1 2 3`, `📎 report.pdf · 24 MB`. The link
 * is an OSC 8 hyperlink where there is colour; without it the address is printed, so it is never
 * out of reach.
 */
const attachmentLines = (
  attachments: Attachment[],
  paint: ReturnType<typeof painter>,
  options: RenderOptions,
): string[] => {
  // The address sits inside our own OSC 8 sequence: a BEL or ESC in it would end that sequence early.
  const link = (label: string, raw: string | undefined) => {
    if (raw === undefined) return label
    const url = visibleControls(raw)
    return options.color ? `\u001b]8;;${url}\u0007${label}\u001b]8;;\u0007` : `${label} ${url}`
  }

  const groups = new Map<string, Attachment[]>()
  for (const attachment of attachments) {
    const key = visibleControls(attachment.name ?? attachment.title ?? attachment.kind)
    groups.set(key, [...(groups.get(key) ?? []), attachment])
  }

  return [...groups].map(([label, same]) => {
    const first = same[0]
    const size = first?.size === undefined ? "" : ` · ${megabytes(first.size)}`
    if (same.length === 1) return paint("dim", `📎 ${link(`${label}${size}`, first?.url)}`)
    const each = same.map((attachment, index) => link(String(index + 1), attachment.url)).join(" ")
    return paint("dim", `📎 ${label} ×${same.length} ${each}`)
  })
}

const megabytes = (bytes: number): string =>
  bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`

const parts = (format: Intl.DateTimeFormat, iso: string) =>
  Object.fromEntries(format.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]))

const timeFormatter = ({ timeZone }: RenderOptions) => {
  const format = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  })
  return (iso: string) => {
    const { hour, minute, second } = parts(format, iso)
    return `${hour}:${minute}:${second}`
  }
}

/** `3 января 2026` — the `г.` Intl adds for Russian is dropped; the line is a heading, not a date field. */
const dayFormatter = ({ locale = "ru-RU", timeZone }: RenderOptions) => {
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  })
  return (iso: string) => format.format(new Date(iso)).replace(/\s*г\.$/, "")
}

const reactionLine = ({ counts, mine }: Reactions): string => {
  const shown = counts.map(({ reaction, count }) => `${visibleControls(reaction)} ${count}`).join("  ")
  return mine ? `${shown}  (you: ${visibleControls(mine)})` : shown
}

const editedAt = (message: Message, options: RenderOptions): string => {
  const edited = message.editedAt ?? message.timestamp
  const time = timeFormatter(options)(edited)
  const day = dayFormatter(options)
  return day(edited) === day(message.timestamp) ? time : `${day(edited)} ${time}`
}
