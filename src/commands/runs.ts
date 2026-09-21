import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { resolveOutput } from "../output.js"
import { findRun, listRuns, readEvents, runsDirFor } from "../runs/run.js"

/**
 * What this tool did, when it was asked to keep the record.
 *
 * Reading the log is not itself an action worth recording, so **nothing here starts a run** — a
 * `max runs list` that created a run directory while listing them would be its own joke.
 */
export const runsCommand = (): Command => {
  const command = new Command("runs").description("recorded runs — what this tool did, and when")

  command
    .command("list")
    .description("recorded runs, newest first")
    .option("--limit <n>", "how many to show", (value) => Number.parseInt(value, 10), 20)
    .action(function (this: Command) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const runs = listRuns(runsDirFor())

      renderer.result(runs.slice(0, options.limit))

      // An empty list reads as broken otherwise, and the reason is that nothing asked for a
      // record — recording is off unless it is asked for (`NEED-52`). The explanation is a
      // diagnostic, so stdout still carries one JSON value and nothing else.
      if (runs.length === 0) renderer.note("nothing recorded — a run is kept only with `--record`")
    })

  command
    .command("show")
    .argument("<run-id>", "an id from `max runs list`")
    .description("one run: what it was, and one line per request")
    .action(function (this: Command, id: string) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)
      const found = runOrRefuse(id)

      // Both, because neither answers the question on its own: the metadata says how it ended and
      // the events say where it went.
      renderer.result({ ...found.metadata, directory: found.dir, events: readEvents(found.dir).map(readable) })
    })

  command
    .command("path")
    .argument("<run-id>", "an id from `max runs list`")
    .description("the directory holding one run")
    .action(function (this: Command, id: string) {
      const options = this.optsWithGlobals()
      const { renderer } = resolveOutput(options)

      // One JSON value on stdout here too, with no exception for convenience (`NEED-88`): a script
      // reads `--json | jq -r .path`, and a terminal prints the bare path as a labelled line.
      renderer.result({ path: runOrRefuse(id).dir })
    })

  return command
}

/**
 * Drops what Pino puts on every line: the level, and the run id, command and profile that are the
 * same for the whole run and are printed above it anyway.
 *
 * Without this the table is five constant columns wide before it reaches the opcode, and the
 * durations and sizes — the reason anyone opened it — fall off the right of an 80-column terminal.
 * `max runs path <id>` still gives the file, envelope and all.
 */
const readable = ({ level, runId, command, profile, ...event }: Record<string, unknown>) => event

const runOrRefuse = (id: string) => {
  const found = findRun(runsDirFor(), id)
  if (!found) throw new CliError("not_found", `no recorded run "${id}" — \`max runs list\` shows what there is`)
  return found
}
