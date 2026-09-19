import { Command } from "commander"
import { VERSION } from "./version.js"

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

  if (out || err) {
    program.configureOutput({
      writeOut: (text) => out?.(text),
      writeErr: (text) => err?.(text),
    })
  }

  return program
}
