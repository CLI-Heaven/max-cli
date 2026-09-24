import { Command, Option } from "commander"
import { openProfileCache } from "../cache/index.js"
import { parseDuration } from "../config.js"
import { asFirstWord } from "../profile.js"
import { MaxServer } from "../server/server.js"
import { forCommand } from "./context.js"

/**
 * `max serve` — stays up, holding one logged-in connection, until Ctrl-C (`MAX-16`).
 *
 * Typed by hand it runs in the foreground until stopped. **Any command that needs MAX starts one
 * in the background when none is running** (`serve` setting, `--no-serve` to decline), and that
 * one is given `--idle`, so it does not outlive the work that started it.
 */
export const serveCommand = (): Command =>
  new Command("serve")
    .description("stay connected to MAX and stream new messages to `max watch`, until Ctrl-C")
    .option("--idle <duration>", "stop after this long with nobody using it — 15m, 1h is 60m")
    .addOption(new Option("--started-by-command").hideHelp())
    .action(async function (this: Command) {
      const { idle, startedByCommand = false } = this.opts<{ idle?: string; startedByCommand?: boolean }>()
      const { renderer, settings, store, run } = forCommand(this)
      const idleMs = idle === undefined ? undefined : parseDuration(idle, "--idle")
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("serve", async (events) => {
        const server = new MaxServer({
          store,
          note: (line) => renderer.note(line),
          ...(events ? { events } : {}),
          ...(cache ? { cache } : {}),
          ...(settings.timeoutMs ? { timeoutMs: settings.timeoutMs } : {}),
          ...(idleMs === undefined ? {} : { idleMs }),
          startedByCommand,
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
    })
