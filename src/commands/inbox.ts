import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { Inbox, MessageHit } from "../domain/models.js"
import { renderMessages } from "../rendering/messages.js"
import { forCommand } from "./context.js"

const FIRST_LOOK_MS = 24 * 60 * 60 * 1000

/**
 * What arrived in every chat since the last look.
 *
 * **The point it starts from is kept in the profile and moved only by a run that printed** — so a
 * scheduled `max inbox` shows each message once, and one that fails shows it again rather than
 * never (`NEED-162`). `--since` is a one-off look and leaves that point where it was. Like every
 * read here it never sends `CHAT_MARK`: looking is not reading (REQUIREMENTS §19).
 */
export const inboxCommand = (): Command =>
  new Command("inbox")
    .description("what other people wrote in any chat since the last check")
    .option("--since <id-or-time>", "from this message id or ISO 8601 time instead; the saved point stays put")
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
          const since =
            options.since !== undefined
              ? client.messages.moment(String(options.since), "--since")
              : saved !== undefined
                ? Date.parse(saved)
                : Date.now() - FIRST_LOOK_MS

          const inbox = await client.inbox.read({ since, limit: settings.limit })
          notes(inbox, renderer.note.bind(renderer))

          const messages: MessageHit[] = inbox.chats.flatMap((chat) =>
            chat.messages.map((message) => ({ ...message, chatTitle: chat.title })),
          )
          if (format === "jsonl") renderer.stream(messages)
          else if (format !== "pretty") renderer.result(inbox)
          else if (messages.length === 0) renderer.note(`nothing new since ${inbox.since}`)
          else {
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

          if (options.since === undefined && inbox.until !== inbox.since) {
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
      note(`${chat.title ?? chat.id}: only the newest shown — \`max messages list ${chat.id} --after ${inbox.since}\``)
    }
  }
  if (inbox.skipped.length > 0) {
    const names = inbox.skipped.map((chat) => chat.title ?? chat.id).join(", ")
    note(`also changed, not shown — too many at once: ${names} — \`max messages list <chat> --after ${inbox.since}\``)
  }
  if (inbox.partial) note("every chat the login named had changed, so older ones may have too")
}
