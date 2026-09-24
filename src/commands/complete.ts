import { existsSync } from "node:fs"
import { script } from "@bomb.sh/tab"
import { CliError } from "@leemour/cli-core"
import { describeOptions, describeProgram } from "@leemour/cli-core/commands"
import { type CompletionSources, formatSuggestions, type Suggestion, suggest } from "@leemour/cli-core/completion"
import { Command } from "commander"
import { type CacheStore, openProfileCache, profileCacheFile } from "../cache/index.js"
import { configuredProfiles } from "../config.js"
import { commandWords, DEFAULT_PROFILE, liftProfile, rootOf } from "../profile.js"
import { outputFor } from "./context.js"

const SHELLS = ["zsh", "bash", "fish", "powershell"]

/**
 * `max complete zsh` prints the script a shell sources; the script then runs
 * `max complete -- <words>` on every Tab, and this answers from the command registry.
 *
 * ⚠ **A Tab never reaches MAX and never writes anything.** Names come from the local cache if it
 * exists — no cache, no names — and nothing goes to stderr: a shell shows whatever it is given.
 */
export const completeCommand = (): Command =>
  new Command("complete")
    .description("shell completion: `max complete zsh` prints the script to source")
    .argument("[words...]")
    .allowUnknownOption()
    .helpOption(false)
    .action(async function (this: Command, words: string[]) {
      const root = rootOf(this)
      const { streams } = outputFor(this)

      // Commander drops the `--` from the operands, so only the raw words tell a request from a shell name.
      const raw = (root as Command & { rawArgs: string[] }).rawArgs
      if (!raw.includes("--")) {
        const [shell] = words
        if (!shell || !SHELLS.includes(shell)) {
          throw new CliError("validation_error", `name a shell: max complete ${SHELLS.join(" | ")}`)
        }
        // tab writes the script through console.log; stdout is where a `source <(…)` reads it.
        script(shell, "max", "max")
        return
      }

      // The last word is still being typed, so it is never taken for a profile: `mess` is on its way to `messages`.
      const { profile, rest } =
        words.length > 1 ? liftProfile(words, commandWords(root)) : { profile: undefined, rest: words }
      const cache = await readableCache(profile ?? process.env.MAX_PROFILE ?? DEFAULT_PROFILE)
      try {
        const suggestions = suggest({
          commands: describeProgram(root),
          globalOptions: describeOptions(root),
          words: rest.length > 0 ? rest : [""],
          sources: sourcesFrom(cache, profile === undefined),
        })
        streams.data(formatSuggestions(suggestions))
      } finally {
        cache?.close()
      }
    })

const readableCache = async (profile: string): Promise<CacheStore | undefined> =>
  existsSync(profileCacheFile(profile)) ? openProfileCache(profile) : undefined

const sourcesFrom = (cache: CacheStore | undefined, atTheStart: boolean): CompletionSources => {
  const chats = () => (cache ? chatSuggestions(cache) : [])
  return {
    arguments: { chat: chats, person: () => (cache ? personSuggestions(cache) : []) },
    options: { chat: chats },
    ...(atTheStart ? { firstWord: profileNames } : {}),
  }
}

/** Ids, with the title beside them: a title with a space in it would reach `max` as two words. */
const chatSuggestions = (cache: CacheStore): Suggestion[] =>
  cache.chats.page({ limit: 500, offset: 0 }).flatMap((chat) => {
    const title = chat.title ?? ""
    return [
      { value: chat.id, description: title },
      ...(/^\S+$/.test(title) ? [{ value: title, description: chat.id }] : []),
    ]
  })

const personSuggestions = (cache: CacheStore): Suggestion[] =>
  cache.people
    .page({ order: "name", limit: 500, offset: 0 })
    .flatMap((person) => [
      { value: person.id, description: person.name ?? "" },
      ...(person.username ? [{ value: `@${person.username}`, description: person.name ?? "" }] : []),
    ])

const profileNames = (): string[] => {
  try {
    return configuredProfiles()
  } catch {
    return []
  }
}
