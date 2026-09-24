import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { renderMessages } from "../rendering/messages.js"
import { ensureServer } from "../server/start.js"
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

      let seen = false
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
              } else if (format === "pretty") {
                streams.data(
                  renderMessages([event.message], {
                    color: context.color,
                    senderColors: settings.senderColors,
                    verbosity: settings.detail,
                    width: process.stdout.columns ?? 80,
                    profile: settings.profile,
                  }),
                )
              } else streams.data(JSON.stringify(event.message))
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
