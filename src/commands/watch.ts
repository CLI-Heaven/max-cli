import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import type { MessageChange, MessageHit } from "../domain/models.js"
import { renderMessages } from "../rendering/messages.js"
import type { ServerEvent } from "../server/server.js"
import { ensureServer } from "../server/start.js"
import { subscribe } from "../server/subscribe.js"
import { forCommand } from "./context.js"

/**
 * `max watch` — new messages as they arrive, from a running `max serve`, until Ctrl-C.
 *
 * `--jsonl` gives one message per line in the shape `messages list` uses, which is what a script,
 * an n8n node or an agent reads. It never marks anything read: the server only listens.
 *
 * `--events` adds edits, deletions and reactions (`MAX-34`), and then every line names its event —
 * `{"event": "message", "message": …}` among them — so a reader of the plain stream, whose lines
 * are bare messages, never meets a line of another shape.
 */
export const watchCommand = (): Command =>
  new Command("watch")
    .description("print new messages as they arrive, from a running `max serve`")
    .option("--events", "also print edits, deletions and reactions; every line then names its event")
    .action(async function (this: Command, options: { events?: boolean }) {
      const context = forCommand(this)
      const { renderer, settings, format, streams, store, run } = context
      const stop = new AbortController()
      const end = () => stop.abort()
      process.once("SIGINT", end)
      process.once("SIGTERM", end)

      const render = (message: MessageHit) =>
        renderMessages([message], {
          color: context.color,
          senderColors: settings.senderColors,
          verbosity: settings.detail,
          width: process.stdout.columns ?? 80,
          profile: settings.profile,
        })
      let seen = false
      await run("watch", async () => {
        try {
          const listen = () =>
            subscribe(
              store.socketPath(),
              settings.profile,
              (event) => {
                if (event.event === "status") {
                  // The first "not connected" is a server still logging in; only a later one is a drop.
                  renderer.note(
                    event.connected
                      ? "connected"
                      : seen
                        ? "MAX dropped the connection; the server is reconnecting"
                        : "the server is logging in to MAX",
                  )
                  seen ||= event.connected
                } else {
                  const line = watchLine(event, {
                    events: options.events === true,
                    pretty: format === "pretty",
                    render,
                  })
                  if (line !== undefined) streams.data(line)
                }
              },
              stop.signal,
            )
          try {
            await listen()
          } catch (error) {
            if (!(error instanceof CliError && error.code === "not_found") || !settings.serve) throw error
            renderer.note("no server was running — starting `max serve` in the background")
            if (!(await ensureServer(store))) {
              throw new CliError("not_found", "`max serve` did not start — its log is beside the profile's state")
            }
            await listen()
          }
        } finally {
          process.off("SIGINT", end)
          process.off("SIGTERM", end)
        }
      })
    })

/**
 * What one event prints. Without `events` the stream is exactly what it always was — bare messages,
 * one per line — so a reader of it never meets a line of another shape.
 */
export const watchLine = (
  event: Exclude<ServerEvent, { event: "status" }>,
  { events, pretty, render }: { events: boolean; pretty: boolean; render: (message: MessageHit) => string },
): string | undefined => {
  if (event.event === "change") {
    if (!events) return undefined
    return pretty ? describeChange(event.change, render) : JSON.stringify(event.change)
  }
  if (pretty) return render(event.message)
  return JSON.stringify(events ? { event: "message", message: event.message } : event.message)
}

const describeChange = (change: MessageChange, render: (message: MessageHit) => string): string => {
  if (change.event === "edit") return `edited:\n${render(change.message)}`
  const where = change.chatTitle ?? change.chatId
  if (change.event === "delete") return `deleted in ${where}: message ${change.messageId}\n`
  const counts = change.reactions.counts.map(({ reaction, count }) => `${reaction} ${count}`).join(", ")
  return `reactions in ${where} on message ${change.messageId}: ${counts || "none"}\n`
}
