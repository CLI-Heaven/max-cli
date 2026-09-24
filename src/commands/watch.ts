import { Command } from "commander"
import { renderMessages } from "../rendering/messages.js"
import { subscribe } from "../server/subscribe.js"
import { forCommand } from "./context.js"

/**
 * `max watch` — new messages as they arrive, from a running `max serve`, until Ctrl-C.
 *
 * `--jsonl` gives one message per line in the shape `messages list` uses, which is what a script,
 * an n8n node or an agent reads. It never marks anything read: the server only listens.
 */
export const watchCommand = (): Command =>
  new Command("watch")
    .description("print new messages as they arrive, from a running `max serve`")
    .action(async function (this: Command) {
      const context = forCommand(this)
      const { renderer, settings, format, streams, store } = context
      const stop = new AbortController()
      const end = () => stop.abort()
      process.once("SIGINT", end)
      process.once("SIGTERM", end)

      try {
        await subscribe(
          store.socketPath(),
          settings.profile,
          (event) => {
            if (event.event === "status") {
              renderer.note(event.connected ? "connected" : "MAX dropped the connection; the server is reconnecting")
            } else if (format === "pretty") {
              streams.data(
                `${renderMessages([event.message], {
                  color: context.color,
                  senderColors: settings.senderColors,
                  verbosity: settings.detail,
                  width: process.stdout.columns ?? 80,
                  profile: settings.profile,
                })}\n`,
              )
            } else streams.data(`${JSON.stringify(event.message)}\n`)
          },
          stop.signal,
        )
      } finally {
        process.off("SIGINT", end)
        process.off("SIGTERM", end)
      }
    })
