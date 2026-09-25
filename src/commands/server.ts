import { Command } from "commander"
import { parseDuration } from "../config.js"
import { serverStatus, stopServer } from "../server/server-connection.js"
import { logPath } from "../server/start.js"
import { VERSION } from "../version.js"
import { forCommand } from "./context.js"
import { detached } from "./serve.js"

/**
 * `max server` — the background server as a thing you act on, the way `max session` is (`CLI-38`).
 * `max serve` stays the foreground form, for systemd and Ctrl-C.
 */
export const serverCommand = (): Command => {
  const command = new Command("server").description("this profile's background server: start, stop, status, restart")

  command
    .command("start")
    .description("start it in the background; answers once it is connected")
    .option("--idle <duration>", "stop after this long with nobody using it — 15m, 1h is 60m")
    .action(async function (this: Command) {
      const { idle } = this.opts<{ idle?: string }>()
      const { renderer, store, run } = forCommand(this)
      await run("server start", async () => {
        if (idle !== undefined) parseDuration(idle, "--idle")
        renderer.result(await detached(store, idle))
      })
    })

  command
    .command("stop")
    .description("stop it, however it was started")
    .action(async function (this: Command) {
      const { renderer, store, run } = forCommand(this)
      await run("server stop", async () => {
        const outcome = await stopServer(store.socketPath(), { force: true })
        renderer.result({ profile: store.profile, stopped: outcome === "stopped" })
        if (outcome === "none") renderer.note(`no server is running for profile "${store.profile}"`)
      })
    })

  command
    .command("status")
    .description("whether it runs, since when, which version, and whether it is connected to MAX")
    .action(async function (this: Command) {
      const { renderer, store, run } = forCommand(this)
      await run("server status", async () => {
        const status = await serverStatus(store.socketPath())
        if (!status) {
          renderer.result({ profile: store.profile, running: false })
          return
        }
        const version = typeof status.version === "string" ? status.version : null
        renderer.result({
          profile: store.profile,
          running: true,
          connected: status.connected === true,
          pid: status.pid ?? null,
          startedAt: status.startedAt ?? null,
          byHand: status.byHand === true,
          version,
          cliVersion: VERSION,
          log: logPath(store),
        })
        // A server from before an upgrade still speaks to MAX with the old code.
        if (version !== VERSION) {
          renderer.note(
            `the server runs ${version ?? "an older version"} and max is ${VERSION} — \`max server restart\``,
          )
        }
      })
    })

  command
    .command("restart")
    .description("stop it and start it again, in the background — one login")
    .option("--idle <duration>", "stop after this long with nobody using it — 15m, 1h is 60m")
    .action(async function (this: Command) {
      const { idle } = this.opts<{ idle?: string }>()
      const { renderer, store, run } = forCommand(this)
      await run("server restart", async () => {
        if (idle !== undefined) parseDuration(idle, "--idle")
        await stopServer(store.socketPath(), { force: true })
        renderer.result(await detached(store, idle))
      })
    })

  return command
}
