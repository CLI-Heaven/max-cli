import { CliError, exitCodeFor, GENERIC_FAILURE, processStreams, type Streams } from "@leemour/cli-core"
import { Command, CommanderError } from "commander"
import { accountCommand } from "./commands/account.js"
import { cacheCommand } from "./commands/cache.js"
import { chatsCommand } from "./commands/chats.js"
import { commandsCommand } from "./commands/commands.js"
import { completeCommand } from "./commands/complete.js"
import { configCommand } from "./commands/config.js"
import { contactsCommand } from "./commands/contacts.js"
import { type Environment, provide } from "./commands/context.js"
import { doctorCommand } from "./commands/doctor.js"
import { inboxCommand } from "./commands/inbox.js"
import { messagesCommand } from "./commands/messages.js"
import { reactionsCommand } from "./commands/reactions.js"
import { recipientsCommand } from "./commands/recipients.js"
import { runsCommand } from "./commands/runs.js"
import { sendsCommand } from "./commands/sends.js"
import { sessionCommand } from "./commands/session.js"
import { skillCommand } from "./commands/skill.js"
import { commandWords, liftProfile } from "./profile.js"
import { VERSION } from "./version.js"

export interface RunOptions extends Environment {
  streams?: Streams
  /** Whether a person is looking. Defaults to whether stdout is a terminal. */
  tty?: boolean
}

export interface ProgramOptions {
  /** Where `--version` and `--help` write. Injected so a test reads them instead of the terminal. */
  out?: (text: string) => void
  err?: (text: string) => void
}

/**
 * The command tree, built fresh on each call.
 *
 * Commander is global state by default — `exitOverride` and the write hooks below turn it into a
 * value a test can drive. A command that calls `process.exit` cannot be tested, and a CLI whose
 * argument parsing is untested is a CLI that breaks on the day someone adds an option.
 */
export const createProgram = ({ out, err }: ProgramOptions = {}): Command => {
  const program = new Command()

  program
    .name("max")
    .usage("[profile] [options] <command>")
    .description(
      "A local command line interface for a personal MAX Messenger account\n\n" +
        "The first word is the profile whenever it is not a command — `max personal chats list`.\n" +
        "`MAX_PROFILE` says the same thing for a whole shell session; without either it is `default`.",
    )
    .version(VERSION, "-V, --version")
    .option(
      "-v, --verbose",
      "more detail in what is shown: -v ids, -vv everything we know",
      (_, level: number) => level + 1,
      0,
    )
    .option("--json", "machine-readable output: one JSON value on stdout, nothing else")
    .option("--jsonl", "machine-readable output: one JSON object per line, for streaming and jq")
    .option("--quiet", "diagnostics off")
    .option("--trace", "one line per request on stderr: ids and timings, never message content")
    .option("--timeout <duration>", "give up on the whole command after this — 30s, 2m, 500ms")
    .option("--offline", "answer from what was recorded and never connect; fails if nothing was")
    .option("--record", "keep this run under `max runs` — ids and timings, never message content")
    .option("--no-record", "do not keep it, whatever the configuration says")
    .showHelpAfterError()

  // One resource per command, one action per subcommand — `max chats list`, `max messages send`.
  // The shape `braze-cli` uses, and the reason there is no `max send`: an action is never a
  // top-level command, so there is one rule instead of a list of exceptions.
  program.addCommand(sessionCommand())
  program.addCommand(accountCommand())
  program.addCommand(chatsCommand())
  program.addCommand(contactsCommand())
  program.addCommand(messagesCommand())
  program.addCommand(reactionsCommand())
  program.addCommand(recipientsCommand())
  program.addCommand(sendsCommand())
  program.addCommand(inboxCommand())
  program.addCommand(configCommand())
  program.addCommand(doctorCommand())
  program.addCommand(cacheCommand())
  program.addCommand(runsCommand())
  program.addCommand(skillCommand())
  program.addCommand(commandsCommand())
  program.addCommand(completeCommand(), { hidden: true })

  // Depth-first: Commander does not pass `configureOutput` down to a command added with
  // `addCommand`, so `max messages --help` would write to the real terminal while the top level
  // wrote to the injected streams — and a test reading stdout would see nothing at all.
  if (out || err) {
    forEachCommand(program, (command) =>
      command.configureOutput({
        writeOut: (text) => out?.(text),
        writeErr: (text) => err?.(text),
      }),
    )
  }

  return program
}

const forEachCommand = (command: Command, apply: (command: Command) => void): void => {
  apply(command)
  for (const child of command.commands) forEachCommand(child, apply)
}

/**
 * Runs the program and **returns an exit code instead of throwing**.
 *
 * A stack trace is not an error message: it puts Node internals on stderr, tells a script nothing
 * it can branch on, and exits 1 for every kind of failure alike. Here a failure becomes a code an
 * agent can switch on, and a sentence a person can act on.
 */
export const run = async (argv: string[], options: RunOptions = {}): Promise<number> => {
  const streams = options.streams ?? processStreams
  const program = createProgram({
    out: (text) => streams.data(text.replace(/\n$/, "")),
    err: (text) => streams.diagnostic(text.replace(/\n$/, "")),
  })

  // Commands print through this rather than the process's own streams, so a test sees their output
  // and not only help and errors.
  provide(program, { ...options, streams })

  // Commander calls process.exit for --help and --version. A library that kills the process cannot
  // be tested and cannot be embedded, so it throws instead and `run` decides the exit code.
  //
  // Depth-first, not one level: `max chats list --nonsense` is handled by the subcommand, and a
  // subcommand left with the default behaviour kills the process from inside a test.
  forEachCommand(program, (command) => command.exitOverride())

  // Before commander, not inside it: a custom argument parser would still have to be told that
  // the first word is sometimes a command, and commander has no hook that runs before it decides
  // which subcommand it is looking at.
  const { profile, rest } = liftProfile(argv, commandWords(program))
  if (profile !== undefined) program.setOptionValue("profile", profile)

  // `max me` — a command that was renamed away — is now a profile with nothing after it, and
  // commander answers a missing command by printing help **on stdout**. That breaks the one
  // contract this program has, and it tells the person nothing about why their command vanished.
  if (profile !== undefined && rest.length === 0) {
    report(streams, options, {
      code: "validation_error",
      message:
        `"${profile}" is not a command, so it was read as a profile name — and no command followed it. ` +
        `Run \`max --help\` for the commands, or \`max ${profile} account show\` if "${profile}" is your profile.`,
    })
    return exitCodeFor("validation_error")
  }

  try {
    await program.parseAsync(rest, { from: "user" })
    return process.exitCode === undefined ? 0 : Number(process.exitCode)
  } catch (error) {
    if (error instanceof CommanderError) {
      // `max chat list` — one letter short of `chats` — now reports an unknown command `list`,
      // which is baffling on its own. This is the everyday cost of the first word being a profile.
      if (profile !== undefined && error.code === "commander.unknownCommand") {
        streams.diagnostic(
          `"${profile}" is not a command, so it was read as a profile name — which left "${rest[0]}" to be one.`,
        )
      }
      return error.exitCode
    }

    if (error instanceof CliError) {
      report(streams, options, { code: error.code, message: error.message, ...error.details })
      return exitCodeFor(error.code)
    }

    report(streams, options, {
      code: "generic_failure",
      message: error instanceof Error ? error.message : String(error),
    })
    return GENERIC_FAILURE
  }
}

interface ReportedError {
  code: string
  message: string
  [detail: string]: unknown
}

/**
 * **A failure never reaches stdout.** An agent reading stdout must not be able to mistake a refusal
 * for a result, so the error goes to stderr — as JSON when nobody is watching, because an exit code
 * says which kind of thing went wrong and nothing about which chat or how long to wait.
 */
const report = (streams: Streams, options: RunOptions, error: ReportedError): void => {
  const interactive = options.tty ?? process.stdout.isTTY === true
  streams.diagnostic(interactive ? `\u2717 ${error.message}` : JSON.stringify({ error }))
}
