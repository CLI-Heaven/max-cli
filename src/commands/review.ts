import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { MessageHit, Review } from "../domain/models.js"
import { renderMessages } from "../rendering/messages.js"
import { REVIEW_DAYS, review, reviewStart } from "../review.js"
import { forCommand } from "./context.js"

/**
 * **Everything said since a point, both sides, in every chat that changed** — the reading half of
 * a review of who owes what. Sorting it is the reader's job, person or agent. Reads only: nothing
 * is marked read, and the saved point of `max inbox --new` stays where it is.
 */
export const reviewCommand = (): Command =>
  new Command("review")
    .description("every message, yours too, in chats that changed since a point — for reviewing who owes what")
    .option("--since <id-or-time>", `where the last review ended; ${REVIEW_DAYS} days ago if not given`)
    .option("--transcribe", "transcribe voice messages not heard yet; slow, and the model must be downloaded")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const context = forCommand(this)
      const { renderer, settings, format, streams, createClient, run } = context
      if (options.offline === true) {
        throw new CliError("validation_error", "`review` asks MAX what changed; with `--offline` nothing did")
      }

      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("review", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })
        try {
          const since =
            options.since === undefined ? reviewStart() : client.messages.moment(String(options.since), "--since")
          const found = await review(client, {
            since,
            cache,
            ...(options.transcribe === true ? { transcribeWith: settings.transcribeModel } : {}),
          })

          if (format !== "pretty") renderer.result(found)
          else {
            const messages: MessageHit[] = found.chats.flatMap((chat) =>
              chat.messages.map(({ transcript, ...message }) => ({
                ...message,
                text:
                  transcript === undefined
                    ? message.text
                    : [message.text, `🎤 ${transcript}`].filter(Boolean).join("\n"),
                chatTitle: chat.title,
              })),
            )
            if (messages.length > 0) {
              streams.data(
                renderMessages(messages, {
                  color: context.color,
                  senderColors: settings.senderColors,
                  verbosity: settings.detail,
                  width: process.stdout.columns ?? 80,
                  profile: settings.profile,
                }),
              )
            }
          }
          notes(found, renderer.note.bind(renderer))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

const notes = (found: Review, note: (message: string) => void): void => {
  for (const chat of found.chats) {
    if (chat.more)
      note(`${chat.title ?? chat.id}: cut short — \`max messages list ${chat.id} --after <last id>\` reads on`)
  }
  if (found.skipped.length > 0) {
    note(`not read — too many chats at once: ${found.skipped.map((chat) => chat.title ?? chat.id).join(", ")}`)
  }
  if (found.partial) note("only the chats this login named were looked at; an older one may have more")
  if (found.unheard.length > 0) {
    note(
      `${found.unheard.length} voice message(s) not heard — \`max review --transcribe\` or \`max messages transcribe\``,
    )
  }
  if (found.transcribeProblem) note(`not transcribed: ${found.transcribeProblem}`)
  note(
    found.complete
      ? `from ${found.since} to ${found.until} — the next review starts with --since ${found.until}`
      : `from ${found.since} to ${found.until}, incomplete — keep --since ${found.since} for the next review`,
  )
}
