import { EXIT_CODES, GENERIC_FAILURE } from "@leemour/cli-core"
import { describeOptions, describeProgram, flatten } from "@leemour/cli-core/commands"
import { Command } from "commander"
import { rootOf } from "../profile.js"
import { VERSION } from "../version.js"
import { outputFor } from "./context.js"

/**
 * The discovery surface an agent reads instead of `--help`, from the registry in `cli-core`. It
 * opens no cache, no session and no settings file: what commands exist does not depend on whether
 * this machine has logged in.
 */
export const commandsCommand = (): Command =>
  new Command("commands")
    .description("every command, option and exit code as JSON — what an agent reads instead of --help")
    .action(function (this: Command) {
      const root = rootOf(this)
      const { renderer, format } = outputFor(this)
      const commands = describeProgram(root)

      if (format === "pretty") {
        renderer.result(
          flatten(commands).map(({ usage, summary, description, mutates, state }) => ({
            command: usage,
            description: summary ?? description,
            writes: mutates ? "yes" : "",
            ...(state ? { state } : {}),
          })),
        )
        return
      }

      renderer.result({
        cli: root.name(),
        version: VERSION,
        description: root.description(),
        globalOptions: describeOptions(root),
        commands,
        exitCodes: { ok: 0, generic_failure: GENERIC_FAILURE, ...EXIT_CODES },
      })
    })
