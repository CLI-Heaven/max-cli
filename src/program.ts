import { CliError, exitCodeFor, GENERIC_FAILURE, processStreams, type Streams } from "@cli-heaven/cli-core"
import { Command, CommanderError } from "commander"
import { chatsCommand } from "./commands/chats.js"
import { contactsCommand } from "./commands/contacts.js"
import { loginCommand } from "./commands/login.js"
import { logoutCommand } from "./commands/logout.js"
import { meCommand } from "./commands/me.js"
import { messagesCommand } from "./commands/messages.js"
import { sendCommand } from "./commands/send.js"
import { VERSION } from "./version.js"

export interface RunOptions {
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
    .description("A local command line interface for a personal MAX Messenger account")
    .version(VERSION, "-v, --version")
    .option("--profile <name>", "which stored account to use", "default")
    .option("--json", "machine-readable output: one JSON value on stdout, nothing else")
    .option("--quiet", "diagnostics off")
    .option("--verbose", "diagnostics on, without anything that identifies you")
    .showHelpAfterError()

  program.addCommand(loginCommand())
  program.addCommand(meCommand())
  program.addCommand(chatsCommand())
  program.addCommand(contactsCommand())
  program.addCommand(messagesCommand())
  program.addCommand(sendCommand())
  program.addCommand(logoutCommand())

  if (out || err) {
    program.configureOutput({
      writeOut: (text) => out?.(text),
      writeErr: (text) => err?.(text),
    })
  }

  return program
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

  // Commander calls process.exit for --help and --version. A library that kills the process cannot
  // be tested and cannot be embedded, so it throws instead and `run` decides the exit code.
  program.exitOverride()
  for (const command of program.commands) command.exitOverride()

  try {
    await program.parseAsync(argv, { from: "user" })
    return process.exitCode === undefined ? 0 : Number(process.exitCode)
  } catch (error) {
    if (error instanceof CommanderError) {
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
