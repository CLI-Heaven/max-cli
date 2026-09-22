import type { Attachment, Message } from "../domain/models.js"

export interface MessageViewOptions {
  color: boolean
  /** One colour per sender. Off unless the profile asks for it, and nothing without `color`. */
  senderColors?: boolean
  /** Wrap text at this many columns; `undefined` leaves lines as they are. */
  width?: number
  /** Set when every message is from one chat: its id is printed once instead of on every message. */
  chatId?: string
  timeZone?: string
}

const ESC = "\u001b["
const paint = (code: string, text: string) => `${ESC}${code}m${text}${ESC}0m`

// Outgoing keeps green to itself, so "which of these is mine" never depends on a hash.
const OWN = "32"
const SENDERS = ["36", "33", "35", "34", "31", "96"]

/**
 * A conversation for a person to read: `[time] author: text`, what identifies it on the line below,
 * attachments after that.
 *
 * Only the human view. The JSON a script reads is the domain model as it always was.
 */
export const renderMessages = (messages: Message[], options: MessageViewOptions): string => {
  if (messages.length === 0) return "(nothing)"

  const dim = (text: string) => (options.color ? paint("2", text) : text)
  const stamp = timeFormatter(options.timeZone)
  const blocks = messages.map((message) => {
    const time = `[${stamp(message.timestamp)}]`
    const author = authorOf(message)
    const [first = "", ...rest] = wrap(message.text, options.width, time.length + author.length + 3)
    const out = [
      `${dim(time)} ${paintAuthor(message, author, options)}: ${first}`.trimEnd(),
      ...rest.map((line) => `  ${line}`),
    ]

    const meta = [
      `messageId=${message.id}`,
      ...(options.chatId === undefined ? [`chatId=${message.chatId}`] : []),
      `senderId=${message.senderId ?? "unknown"}`,
      ...(message.editedAt ? [`edited=${stamp(message.editedAt)}`] : []),
    ]
    out.push(dim(`  ${meta.join(" ")}`))
    for (const attachment of message.attachments) out.push(`  attachment: ${describe(attachment)}`)
    return out.join("\n")
  })

  const header = options.chatId === undefined ? [] : [dim(`chatId=${options.chatId}`)]
  return [...header, ...blocks].join("\n\n")
}

const authorOf = (message: Message): string => {
  if (message.outgoing === true) return "you"
  if (message.senderName) return message.senderName
  return message.senderId ? `"${message.senderId}"` : "unknown"
}

const paintAuthor = (message: Message, author: string, options: MessageViewOptions): string => {
  if (!options.color) return author
  if (!options.senderColors) return paint("1", author)
  const code = message.outgoing === true ? OWN : SENDERS[hash(message.senderId ?? author) % SENDERS.length]
  return paint(`1;${code}`, author)
}

const hash = (value: string): number => [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)

/** The link goes last and whole: a wrapped URL is one a terminal can no longer open. */
const describe = ({ kind, width, height, title, url }: Attachment): string =>
  [kind, width && height ? `${width}×${height}` : undefined, title && title !== url ? `"${title}"` : undefined, url]
    .filter(Boolean)
    .join(" ")

const timeFormatter = (timeZone?: string) => {
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  })
  return (iso: string) => {
    const part = Object.fromEntries(format.formatToParts(new Date(iso)).map(({ type, value }) => [type, value]))
    return `${part.day}.${part.month}.${part.year} ${part.hour}:${part.minute}:${part.second}`
  }
}

/** The first line shares its row with the time and the author; the rest are indented by two. */
const wrap = (text: string, width: number | undefined, offset: number): string[] =>
  text.split("\n").flatMap((line, index) => {
    if (width === undefined) return [line]
    const rest = Math.max(20, width - 2)
    return fold(line, index === 0 ? Math.max(20, width - offset) : rest, rest)
  })

const fold = (line: string, first: number, rest: number): string[] => {
  const out: string[] = []
  let current = ""
  let room = first
  for (const word of line.split(" ")) {
    if (current !== "" && current.length + 1 + word.length > room) {
      out.push(current)
      current = word
      room = rest
    } else {
      current = current === "" ? word : `${current} ${word}`
    }
  }
  out.push(current)
  return out
}
