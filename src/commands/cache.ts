import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { resolveSettings } from "../config.js"
import { outputFor } from "./context.js"

/**
 * The way out, and it matters more than it looks.
 *
 * Everything else in this tool can be re-run; a cache is the one part that remembers being wrong.
 * While the schema is still moving, the fix for a cache that misbehaves has to be a command rather
 * than finding a file and deleting it.
 */
export const cacheCommand = (): Command => {
  const command = new Command("cache").description("the local copy of chats, contacts and messages")

  command
    .command("clear")
    .description("forget everything this profile has cached")
    .action(async function (this: Command) {
      const { profile } = resolveSettings(this.optsWithGlobals())
      const { renderer } = outputFor(this)
      const cache = await openProfileCache(profile, { onProblem: (message) => renderer.note(message) })

      if (!cache) {
        renderer.result({ profile: profile, cleared: false })
        renderer.note("there is no cache for this profile")
        return
      }

      try {
        cache.clear()
        renderer.result({ profile: profile, cleared: true })
        renderer.success(`forgot everything cached for "${profile}"`)
      } finally {
        cache.close()
      }
    })

  return command
}
