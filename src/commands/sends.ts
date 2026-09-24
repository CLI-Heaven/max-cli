import { Command } from "commander"
import { SendJournal, sendsPathFor } from "../sends/journal.js"
import { forCommand } from "./context.js"

/** Every attempt to send from this profile, kept whatever `--record` says. Never the text. */
export const sendsCommand = (): Command => {
  const command = new Command("sends").description("every attempt to send from this profile — never the text")

  command
    .command("list")
    .description("attempts to send, newest first: sent, refused, failed, or not known")
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10), 20)
    .action(function (this: Command) {
      const { limit } = this.opts<{ limit: number }>()
      const { settings, renderer } = forCommand(this)
      const entries = new SendJournal(sendsPathFor(settings.profile)).entries().reverse()

      renderer.stream(entries.slice(0, limit))
      if (entries.length === 0) renderer.note(`profile ${settings.profile} has not tried to send anything`)
    })

  return command
}
