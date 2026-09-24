import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { Inbox, MessageHit } from "../domain/models.js"
import { renderMessages } from "../rendering/messages.js"
import { forCommand } from "./context.js"

const FIRST_LOOK_MS = 24 * 60 * 60 * 1000

/**
 * Two questions, one command (`NEED-171`).
 *
 * **Plain `max inbox` — what is unread**, as MAX counts it. For a person. Since nothing here marks
 * anything read (REQUIREMENTS §19), it answers the same until the messages are read elsewhere.
 *
 * **`--new` — what arrived since the last check.** For a scheduled run: the point it starts from is
 * kept in the profile and moved only by a run that printed, so each message shows once, and a run
 * that fails shows it again rather than never (`NEED-162`). `--since` is a one-off look from a time
 * of your choosing and leaves that point where it was.
 */
export const inboxCommand = (): Command =>
  new Command("inbox")
    .description("other people's unread messages in every chat; --new for what arrived since the last check")
    .option("--new", "what arrived since the last check, each message once — for scheduled runs")
    .option("--since <id-or-time>", "what arrived after this message id or ISO 8601 time; the saved point stays put")
    .option("--limit <n>", "at most this many per chat, the newest", (value) => Number.parseInt(value, 10))
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const context = forCommand(this)
      const { renderer, settings, format, streams, store, createClient, run } = context
      if (options.offline === true) {
        throw new CliError("validation_error", "`inbox` asks MAX what is new; with `--offline` there is nothing new")
      }

      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("inbox", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          const saved = store.readState().lastCheckAt
          const inbox =
            options.since !== undefined
              ? await client.inbox.since({
                  since: client.messages.moment(String(options.since), "--since"),
                  limit: settings.limit,
                })
              : options.new === true
                ? await client.inbox.since({
                    since: saved === undefined ? Date.now() - FIRST_LOOK_MS : Date.parse(saved),
                    limit: settings.limit,
                  })
                : await client.inbox.unread({ limit: settings.limit })
          notes(inbox, renderer.note.bind(renderer))

          const messages: MessageHit[] = inbox.chats.flatMap((chat) =>
            chat.messages.map((message) => ({ ...message, chatTitle: chat.title })),
          )
          if (format === "jsonl") renderer.stream(messages)
          else if (format !== "pretty") renderer.result(inbox)
          else if (messages.length === 0) {
            renderer.note(inbox.mode === "unread" ? "nothing unread" : `nothing new since ${inbox.since}`)
          } else {
            messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
            streams.data(
              `${renderMessages(messages, {
                color: context.color,
                senderColors: settings.senderColors,
                verbosity: settings.detail,
                width: process.stdout.columns ?? 80,
                profile: settings.profile,
              })}\n`,
            )
          }

          if (options.new === true && options.since === undefined && inbox.until !== inbox.since) {
            store.writeState({ ...store.readState(), lastCheckAt: inbox.until })
          }
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

const notes = (inbox: Inbox, note: (message: string) => void): void => {
  for (const chat of inbox.chats) {
    if (chat.more) {
      const rest = inbox.since === undefined ? `--limit ${chat.unreadCount}` : `--after ${inbox.since}`
      note(`${chat.title ?? chat.id}: only the newest shown — \`max messages list ${chat.id} ${rest}\``)
    }
  }
  if (inbox.skipped.length > 0) {
    const names = inbox.skipped.map((chat) => chat.title ?? chat.id).join(", ")
    const after = inbox.since === undefined ? "" : ` --after ${inbox.since}`
    note(`not read — too many chats at once: ${names} — \`max messages list <chat>${after}\` reads one`)
  }
  if (inbox.partial) note("only the 40 newest chats were looked at; an older one may have more")
}
