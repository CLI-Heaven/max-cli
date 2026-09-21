import { CliError } from "@leemour/cli-core"
import type { Command } from "commander"

export const DEFAULT_PROFILE = "default"

/** How the command line names this profile: the first word, or nothing at all for the default. */
export const asFirstWord = (profile: string): string => (profile === DEFAULT_PROFILE ? "" : `${profile} `)

/**
 * A profile name becomes a file name — `<state>/profiles/<name>.json` (`session/store.ts:103`) —
 * and the keyring account is the same string.
 *
 * The first word on the command line is now the profile, so a mistyped path arrives here as a
 * name, and `a/../b` would write that file somewhere nobody would think to look.
 */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const usableProfileName = (profile: string): string => {
  if (!PLAIN_NAME.test(profile)) {
    throw new CliError(
      "validation_error",
      `"${profile}" cannot be a profile name — letters, digits, dot, dash and underscore only, ` +
        "starting with a letter or a digit",
    )
  }
  return profile
}

/**
 * Every word that means a command at the top level.
 *
 * Taken off the built program rather than written out, because a list written out goes stale the
 * day a command is added — and `help` is in it without being in `program.commands`: commander
 * answers `max help chats` from an implicit command that is not in that array.
 */
export const commandWords = (program: Command): Set<string> =>
  new Set(["help", ...program.commands.flatMap((command) => [command.name(), ...command.aliases()])])

/**
 * **The first word is the profile unless it names a command.** `max personal chats list`, and
 * `max chats list` on the default profile, with no flag in either.
 *
 * An option is never a profile, so `max --json chats list` still works.
 */
export const liftProfile = (argv: string[], words: Set<string>): { profile?: string; rest: string[] } => {
  const [first, ...rest] = argv
  if (first === undefined || first.startsWith("-") || words.has(first)) return { rest: argv }
  return { profile: first, rest }
}

/**
 * Refused at creation, which is the only moment it can still be explained.
 *
 * A profile named after a command breaks silently and in the other direction: `max chats` would
 * have to mean the command, so the profile called `chats` could never be selected at all.
 */
export const refuseCommandName = (profile: string, words: Set<string>): void => {
  if (words.has(profile)) {
    throw new CliError(
      "validation_error",
      `"${profile}" is a command, so \`max ${profile} …\` would always mean the command and never ` +
        "this profile. Pick a name that is not one of: " +
        [...words].sort().join(", "),
    )
  }
}

/** The root of the command tree, from anywhere inside it. */
export const rootOf = (command: Command): Command => {
  let root = command
  while (root.parent) root = root.parent
  return root
}
