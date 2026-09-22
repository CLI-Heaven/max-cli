import { readFileSync } from "node:fs"
import { Command } from "commander"
import { forCommand } from "./context.js"

/** Beside `dist/` in the package and in a checkout alike, so the skill is always this version's. */
const SKILL = new URL("../../skills/max-cli/SKILL.md", import.meta.url)

export const skillCommand = (): Command => {
  const command = new Command("skill").description("the instructions an agent is given for this tool")

  command
    .command("show")
    .description("print SKILL.md — `max skill show > ~/.claude/skills/max-cli/SKILL.md` installs it")
    .action(function (this: Command) {
      const { settings, renderer, streams } = forCommand(this)
      const content = readFileSync(SKILL, "utf8").trimEnd()
      // The file itself even into a pipe: installing it *is* a redirect, and a redirect is where
      // every other command switches to JSON. Asked for by name, it is JSON like the rest.
      if (settings.json || settings.jsonl) renderer.result({ name: "max-cli", content })
      else streams.data(content)
    })

  return command
}
