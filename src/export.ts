import { singleLine, visibleControls } from "@leemour/cli-core"
import type { Attachment, Message, QuotedMessage } from "./domain/models.js"

/** A stretch of the chat this machine never read. `from: null` is "since the chat began". */
export interface Unread {
  from: string | null
  to: string
}

export interface Window {
  from: number
  to: number
}

/** Windows read completely, oldest first, with those that share a message merged into one. */
export const heldWindows = (ranges: Window[]): Window[] => {
  const windows: Window[] = []
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const previous = windows.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else windows.push({ ...range })
  }
  return windows
}

/**
 * **What an export cannot contain**, worked out from the windows the cache read completely.
 *
 * Paging with `--before <id>` asks from that message's own time, so consecutive pages overlap by
 * one message and merge here. A window that does not touch the next is a stretch nobody asked MAX
 * for — it may hold messages or none; the cache cannot tell, and says so rather than guessing.
 */
export const unreadStretches = (
  ranges: Window[],
  { since, last }: { since?: number; last?: number } = {},
): Unread[] => {
  const held = heldWindows(ranges).filter((window) => since === undefined || window.to >= since)
  const first = held[0]
  const newest = held.at(-1)
  if (!first || !newest) return []

  const iso = (time: number) => new Date(time).toISOString()
  const stretches: Unread[] = []
  if (since === undefined || first.from > since) {
    stretches.push({ from: since === undefined ? null : iso(since), to: iso(first.from) })
  }
  for (const [index, window] of held.slice(1).entries()) {
    stretches.push({ from: iso(held[index]?.to ?? window.from), to: iso(window.from) })
  }
  if (last !== undefined && last > newest.to) stretches.push({ from: iso(newest.to), to: iso(last) })
  return stretches
}

/**
 * One chat as a document a person reads: a heading per day, `hh:mm Name`, the text, replies and
 * forwards quoted, attachments as links. Files are not fetched — `max messages download` does that.
 *
 * Control characters are made visible here, not only on a terminal: the document is read with `cat`
 * as often as in an editor, and a byte that rewrites the screen is nobody's text.
 */
export const toMarkdown = (title: string, messages: Message[], timeZone?: string): string => {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

  const lines = [`# ${singleLine(title)}`]
  let today = ""
  for (const message of messages) {
    const when = new Date(message.timestamp)
    const date = day.format(when)
    if (date !== today) {
      lines.push("", `## ${date}`)
      today = date
    }

    const edited = message.editedAt ? " · edited" : ""
    lines.push("", `**${clock.format(when)} ${nameOf(message)}**${edited}`)
    if (message.replyTo)
      lines.push(...quote(`**${nameOf(message.replyTo)}:** ${visibleControls(message.replyTo.text)}`))
    if (message.forwardedFrom) lines.push(...forwarded(message.forwardedFrom))
    if (message.text) lines.push(visibleControls(message.text))
    lines.push(...message.attachments.map((attachment) => `- ${attachmentLine(attachment)}`))
  }
  return `${lines.join("\n")}\n`
}

const nameOf = (message: Pick<Message, "senderName" | "senderId" | "outgoing">): string =>
  singleLine(message.senderName ?? (message.outgoing ? "you" : (message.senderId ?? "unknown")))

const quote = (text: string): string[] => text.split("\n").map((line) => `> ${line}`)

const forwarded = (original: QuotedMessage): string[] => [
  `> forwarded from **${nameOf(original)}**`,
  ...(original.text ? quote(visibleControls(original.text)) : []),
  ...original.attachments.map((attachment) => `> - ${attachmentLine(attachment)}`),
]

const attachmentLine = (attachment: Attachment): string => {
  const label = singleLine(attachment.title ?? attachment.name ?? attachment.kind)
  if (attachment.url && /^https?:\/\//i.test(attachment.url)) return `[${label}](${singleLine(attachment.url)})`
  return attachment.name ? `${attachment.kind}: ${singleLine(attachment.name)}` : attachment.kind
}
