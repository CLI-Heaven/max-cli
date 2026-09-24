import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { asFirstWord } from "../profile.js"
import { MaxServer } from "../server/server.js"
import { forCommand } from "./context.js"

/**
 * `max serve` — stays up, holding one logged-in connection, until Ctrl-C (`MAX-16`).
 *
 * Foreground only. Running it in the background is systemd's or `nohup`'s job, and a tool that
 * daemonises itself leaves a connection behind that nobody remembers starting.
 */
export const serveCommand = (): Command =>
  new Command("serve")
    .description("stay connected to MAX and stream new messages to `max watch`, until Ctrl-C")
    .action(async function (this: Command) {
      const { renderer, settings, store } = forCommand(this)
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })
      const server = new MaxServer({
        store,
        note: (line) => renderer.note(line),
        ...(cache ? { cache } : {}),
        ...(settings.timeoutMs ? { timeoutMs: settings.timeoutMs } : {}),
      })

      const stop = () => void server.stop()
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
      try {
        await server.start()
        renderer.note(
          `connected — \`max ${asFirstWord(settings.profile)}watch\` in another terminal shows new messages`,
        )
        await server.done
      } catch (error) {
        await server.stop()
        throw error
      } finally {
        process.off("SIGINT", stop)
        process.off("SIGTERM", stop)
        cache?.close()
      }
    })
