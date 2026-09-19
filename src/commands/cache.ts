import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { resolveOutput } from "../output.js"

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
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const cache = await openProfileCache(options.profile)

      if (!cache) {
        renderer.result({ profile: options.profile, cleared: false })
        renderer.note("there is no cache for this profile")
        return
      }

      try {
        cache.clear()
        renderer.result({ profile: options.profile, cleared: true })
        renderer.success(`forgot everything cached for "${options.profile}"`)
      } finally {
        cache.close()
      }
    })

  return command
}
