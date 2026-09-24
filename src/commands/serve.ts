import { CliError } from "@leemour/cli-core"
import { Command, Option } from "commander"
import { openProfileCache } from "../cache/index.js"
import { parseDuration } from "../config.js"
import { asFirstWord } from "../profile.js"
import { MaxServer } from "../server/server.js"
import { serverStatus, stopServer } from "../server/server-connection.js"
import { logPath, startInBackground } from "../server/start.js"
import type { SessionStore } from "../session/store.js"
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
    .option("--detach", "run in the background instead; still stopped only by `max serve --stop`")
    .option("--stop", "stop this profile's server, however it was started")
    .addOption(new Option("--started-by-command").hideHelp())
    .action(async function (this: Command) {
      const {
        idle,
        detach = false,
        stop: stopping = false,
        startedByCommand = false,
      } = this.opts<{ idle?: string; detach?: boolean; stop?: boolean; startedByCommand?: boolean }>()
      const { renderer, settings, store, run } = forCommand(this)
      const idleMs = idle === undefined ? undefined : parseDuration(idle, "--idle")
      if (detach && stopping)
        throw new CliError("validation_error", "--detach starts a server and --stop ends one; give one")

      if (stopping) {
        const outcome = await stopServer(store.socketPath(), { force: true })
        renderer.result({ profile: store.profile, stopped: outcome === "stopped" })
        if (outcome === "none") renderer.note(`no server is running for profile "${store.profile}"`)
        return
      }
      if (detach) {
        renderer.result(await detached(store, idle))
        return
      }
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

/** Logging in takes a second or two; a server that has not answered by now is not coming. */
const START_WAIT_MS = 15_000

/**
 * Starts a server by hand, in the background, and returns once it answers. A server a command
 * started is replaced by it; one already started by hand is left as it is.
 */
const detached = async (store: SessionStore, idle: string | undefined) => {
  const before = await serverStatus(store.socketPath())
  const about = { profile: store.profile, socket: store.socketPath(), log: logPath(store) }
  if (before?.byHand === true) return { ...about, pid: before.pid, started: false }

  const spawned = startInBackground(store, { serveArgs: idle === undefined ? [] : ["--idle", idle] })
  if (spawned === undefined) {
    throw new CliError("validation_error", "no session to start with, or a server is already being started — try again")
  }
  const until = Date.now() + START_WAIT_MS
  while (Date.now() < until) {
    const status = await serverStatus(store.socketPath())
    if (status?.byHand === true) return { ...about, pid: status.pid, started: true }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new CliError("timeout", `the server did not start within ${START_WAIT_MS / 1000}s — see ${about.log}`)
}
