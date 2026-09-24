import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { renderMessages } from "../rendering/messages.js"
import { answers } from "../server/server.js"
import { startInBackground } from "../server/start.js"
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
        const listen = () =>
          subscribe(
            store.socketPath(),
            settings.profile,
            (event) => {
              if (event.event === "status") {
                renderer.note(event.connected ? "connected" : "MAX dropped the connection; the server is reconnecting")
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
          startInBackground(store)
          renderer.note("no server was running — starting `max serve` in the background")
          await untilListening(store.socketPath(), START_WAIT_MS)
          await listen()
        }
      } finally {
        process.off("SIGINT", end)
        process.off("SIGTERM", end)
      }
    })

/** Logging in takes a second or two; a server that has not listened by now is not coming. */
const START_WAIT_MS = 15_000

const untilListening = async (path: string, withinMs: number): Promise<void> => {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
    if (await answers(path)) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new CliError(
    "not_found",
    `\`max serve\` did not start within ${withinMs / 1000}s — its log is beside the profile's state`,
  )
}
