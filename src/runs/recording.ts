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
  options: { record?: boolean | undefined; verbose?: boolean | undefined }
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
 * Two sinks, one event object (plan §3.1, §3.7): `--verbose` shows it as it happens and keeps
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
  const verbose = options.options.verbose === true

  const run: Run | undefined =
    options.options.record === true
      ? startRun({
          runsDir: options.runsDir ?? runsDirFor(),
          command: options.command,
          profile: options.profile,
          cliVersion: VERSION,
          ...(options.keepDays === undefined ? {} : { keepDays: options.keepDays }),
          ...(options.now === undefined ? {} : { now: options.now }),
        })
      : undefined

  let requests = 0

  const events = (event: DiagnosticEvent): void => {
    if (event.event === "request") requests += 1
    // Text for a person, one JSON object per line for anything else — the rule `resolveOutput`
    // already applies to the data stream (`NEED-53`). Never stdout, in any mode.
    if (verbose) streams.diagnostic(options.format === "pretty" ? renderEvent(event) : JSON.stringify(event))
    run?.logger.info(event)
  }

  try {
    const answer = await body(events)
    await run?.finish("success", { requests })
    return answer
  } catch (error) {
    await run?.finish("failed", {
      requests,
      // The code a script branches on, never the sentence: MAX's refusals quote our payload back.
      ...(error instanceof CliError ? { errorCode: error.code } : {}),
    })
    throw error
  }
}
