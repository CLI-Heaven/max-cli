import { isNewer, updateCommand } from "@leemour/cli-core/update"
import { Command } from "commander"
import { installer, latest, PACKAGE, runUpdate } from "../update.js"
import { VERSION } from "../version.js"
import { environmentOf, outputFor } from "./context.js"

const BY_HAND: Record<string, string> = {
  checkout: "this is a checkout: `git pull && pnpm install && pnpm build`",
  npx: "npx runs whatever version it is asked for: `npx @leemour/max-cli@latest`",
  unknown: "cannot tell how max was installed, so nothing was run",
}

/**
 * Updates `max` with the package manager that installed it. Never runs by itself: this program
 * holds the token of a personal account, and code that replaces itself unasked is not wanted here.
 */
export const selfUpdateCommand = (): Command =>
  new Command("update")
    .description("update max with the package manager that installed it; --check only looks")
    .option("--check", "say whether a newer version exists, and install nothing")
    .action(async function (this: Command, { check }: { check?: boolean }) {
      const { renderer, format } = outputFor(this)
      const environment = environmentOf(this).update ?? {}
      const found = installer(environment)
      const argv = updateCommand(found, PACKAGE)
      const newest = await latest(environment)
      const newer = newest !== undefined && isNewer(newest, VERSION)
      const answer = {
        current: VERSION,
        latest: newest ?? null,
        newer,
        installer: found,
        command: argv?.join(" ") ?? null,
      }

      if (check || !newer || !argv) {
        if (!check && newest === undefined) renderer.warn("npm did not answer, so nothing was run")
        else if (!check && !newer) renderer.note(`max ${VERSION} is the newest`)
        else if (!check && !argv) renderer.warn(BY_HAND[found] ?? BY_HAND.unknown ?? "")
        renderer.result(format === "pretty" ? summary(answer) : { ...answer, updated: false })
        return
      }

      renderer.note(`running: ${argv.join(" ")}`)
      const code = runUpdate(argv, environment)
      if (code !== 0) throw new Error(`${argv[0]} exited with ${code}; max is still ${VERSION}`)
      renderer.result(format === "pretty" ? `max ${VERSION} → ${newest}` : { ...answer, updated: true })
    })

const summary = ({ current, latest, newer }: { current: string; latest: string | null; newer: boolean }) =>
  latest === null
    ? `max ${current}; npm did not answer`
    : newer
      ? `max ${latest} is out — you have ${current}`
      : `max ${current} is the newest`
