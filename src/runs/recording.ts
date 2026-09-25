import { CliError, processStreams, type RenderFormat, type Streams } from "@leemour/cli-core"
import { VERSION } from "../version.js"
import { type DiagnosticEvent, renderEvent } from "./events.js"
import { type Run, runsDirFor, startRun } from "./run.js"

export interface RecordingOptions {
  /** As typed, without the arguments: `chats list`. It names the run directory. */
  command: string
  profile: string
  /**
   * What `commander` parsed. `record` is three-valued on purpose: `--record`, `--no-record`, and
   * absent — the third is where the configuration file's `"record": true` plugs in (thread C).
   */
  options: { record?: boolean | undefined; keepFailed?: boolean | undefined; trace?: boolean | undefined }
  /** What `resolveOutput` decided for the data stream. Diagnostics follow it (`NEED-53`). */
  format: RenderFormat
  streams?: Streams
  /** Tests point this at a temporary directory. */
  runsDir?: string
  keepDays?: number
  now?: () => Date
}

/**
 * Runs one command with the diagnostics turned on, and **finalizes on every path**.
 *
 * Two sinks, one event object (plan §3.1, §3.7): `--trace` shows it as it happens and keeps
 * nothing, `--record` keeps it and shows nothing. Either, both, or — by default — neither, in
 * which case this costs a counter.
 *
 * The body gets the emitter to hand to `MaxClient`. It is a wrapper rather than three lines in
 * each command because the failure it prevents is the quiet one: a run directory left saying
 * `running` because the command that owned it threw on the way out.
 */
export const recorded = async <T>(
  options: RecordingOptions,
  body: (events: (event: DiagnosticEvent) => void) => Promise<T>,
): Promise<T> => {
  const streams = options.streams ?? processStreams
  const trace = options.options.trace === true

  const open = (extra: { startedAt?: Date } = {}): Run =>
    startRun({
      runsDir: options.runsDir ?? runsDirFor(),
      command: options.command,
      profile: options.profile,
      cliVersion: VERSION,
      // Asked for, so never silent, `--quiet` included (`NEED-53`) — but the operation it
      // describes has happened or is under way, and failing the command now invites a retry
      // that sends twice (`NEED-133`).
      onError: (error) => {
        const warning = `this run is not recorded past this point: ${error.message}`
        streams.diagnostic(options.format === "pretty" ? warning : JSON.stringify({ warning }))
      },
      ...(options.keepDays === undefined ? {} : { keepDays: options.keepDays }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...extra,
    })

  const run: Run | undefined = options.options.record === true ? open() : undefined
  // Unrecorded, a run is still kept if it fails (`NEED-268`): held here until the outcome is known,
  // and only the newest — a server lives for hours.
  const held: DiagnosticEvent[] | undefined = !run && options.options.keepFailed === true ? [] : undefined
  const startedAt = (options.now ?? (() => new Date()))()

  let requests = 0

  const events = (event: DiagnosticEvent): void => {
    if (event.event === "request") requests += 1
    // Text for a person, one JSON object per line for anything else — the rule `resolveOutput`
    // already applies to the data stream (`NEED-53`). Never stdout, in any mode.
    if (trace) streams.diagnostic(options.format === "pretty" ? renderEvent(event) : JSON.stringify(event))
    run?.logger.info(event)
    if (held) {
      held.push(event)
      if (held.length > HELD_AT_MOST) held.shift()
    }
  }

  try {
    const answer = await body(events)
    await run?.finish("success", { requests })
    return answer
  } catch (error) {
    const failed = run ?? (held ? keep(open({ startedAt }), held) : undefined)
    if (failed) {
      if (!(error instanceof CliError)) failed.logger.info(crashOf(error))
      await failed.finish("failed", {
        requests,
        ...outcomeOf(error),
        ...(run ? {} : { keptBecauseFailed: true }),
      })
    }
    throw error
  }
}

const HELD_AT_MOST = 500

const keep = (run: Run, events: DiagnosticEvent[]): Run => {
  for (const event of events) run.logger.info(event)
  return run
}

/** The code a script branches on, never the sentence: MAX's refusals quote our payload back. */
const outcomeOf = (error: unknown): { errorCode: string; maxError?: string } => {
  if (!(error instanceof CliError)) return { errorCode: "generic_failure" }
  const maxError = typeof error.details.maxError === "string" ? error.details.maxError : undefined
  return { errorCode: error.code, ...(maxError ? { maxError } : {}) }
}

/**
 * Where a crash happened, not what it said: the class and up to ten frames as `function file:line`,
 * paths cut to what follows the package's `dist/` or `src/`. **Never `message`** — it can hold
 * whatever the failing line was handling.
 */
export const crashOf = (error: unknown): { event: "crash"; errorName: string; frames: string[] } => {
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : ""
  const frames = stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .slice(0, 10)
    .map((line) => {
      const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(line)
      if (!match) return "?"
      const [, fn, path = "", lineNumber] = match
      const file = /(?:^|\/)(?:dist|src)\/(.+)$/.exec(path)?.[1] ?? path.split("/").at(-1)
      return `${fn ?? "<anonymous>"} ${file}:${lineNumber}`
    })
  return { event: "crash", errorName: error instanceof Error ? error.name : typeof error, frames }
}
