import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, captureStreams } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { DiagnosticEvent } from "./events.js"
import { recorded } from "./recording.js"
import { listRuns } from "./run.js"

const runsDir = () => join(mkdtempSync(join(tmpdir(), "max-recording-")), "runs")

const REQUEST: DiagnosticEvent = {
  event: "request",
  operation: "chats.history",
  opcode: 49,
  seq: 3,
  bytes: 180,
  ids: { chat: "111" },
}

const RESPONSE: DiagnosticEvent = {
  event: "response",
  operation: "chats.history",
  opcode: 49,
  seq: 3,
  bytes: 4200,
  durationMs: 118,
  counts: { messages: 3 },
  outcome: "ok",
}

const run = async (
  options: { record?: boolean; verbose?: boolean; quiet?: boolean; format?: "pretty" | "json" },
  body?: (events: (event: DiagnosticEvent) => void) => Promise<void>,
) => {
  const streams = captureStreams()
  const dir = runsDir()

  const answer = await recorded(
    {
      command: "chats list",
      profile: "default",
      options: {
        ...(options.record === undefined ? {} : { record: options.record }),
        verbose: options.verbose,
        ...(options.quiet === undefined ? {} : { quiet: options.quiet }),
      },
      format: options.format ?? "pretty",
      streams,
      runsDir: dir,
    },
    body ??
      (async (events) => {
        events(REQUEST)
        events(RESPONSE)
      }),
  ).catch((error: unknown) => error)

  return { streams, dir, answer }
}

describe("with neither flag", () => {
  it("**writes nothing, anywhere** — recording is asked for, never assumed", async () => {
    const { streams, dir } = await run({})

    expect(streams.stdout).toEqual([])
    expect(streams.stderr).toEqual([])
    expect(existsSync(dir)).toBe(false)
  })
})

describe("--verbose", () => {
  it("shows a person the line, and puts nothing on stdout", async () => {
    const { streams } = await run({ verbose: true })

    expect(streams.stdout).toEqual([])
    expect(streams.stderr[0]).toContain("→ chats.history")
    expect(streams.stderr[1]).toContain("118ms")
  })

  it("gives a script one JSON object per line instead", async () => {
    const { streams } = await run({ verbose: true, format: "json" })

    expect(streams.stdout).toEqual([])
    expect(streams.stderr.map((line) => JSON.parse(line).event)).toEqual(["request", "response"])
  })

  it("**outranks `--quiet`** (`NEED-53`) — the flag a person just typed has to do something", async () => {
    const { streams } = await run({ verbose: true, quiet: true })

    expect(streams.stderr).toHaveLength(2)
    expect(streams.stdout).toEqual([])
  })

  it("**keeps nothing** — showing and keeping are the two different things", async () => {
    const { dir } = await run({ verbose: true })

    expect(existsSync(dir)).toBe(false)
  })
})

describe("--record", () => {
  it("keeps the events and says how the command ended", async () => {
    const { streams, dir } = await run({ record: true })

    // Recording is not showing: the terminal saw none of it.
    expect(streams.stderr).toEqual([])

    const [metadata] = listRuns(dir)
    expect(metadata).toMatchObject({ command: "chats list", profile: "default", status: "success", requests: 1 })

    const day = readdirSync(dir)[0] as string
    const events = readFileSync(join(dir, day, metadata?.runId as string, "events.jsonl"), "utf8")
    expect(events.trim().split("\n")).toHaveLength(2)
  })

  it("records both at once when both are asked for, from the one event", async () => {
    const { streams, dir } = await run({ record: true, verbose: true })

    expect(streams.stderr).toHaveLength(2)
    expect(listRuns(dir)).toHaveLength(1)
  })

  it("**finishes the run when the command fails**, and keeps the code a script branches on", async () => {
    const { dir, answer } = await run({ record: true }, async (events) => {
      events(REQUEST)
      throw new CliError("authentication_error", 'no session for profile "default"')
    })

    expect(answer).toMatchObject({ code: "authentication_error" })
    expect(listRuns(dir)[0]).toMatchObject({ status: "failed", errorCode: "authentication_error", requests: 1 })
  })

  it("records a command that failed before it ever reached MAX", async () => {
    const { dir } = await run({ record: true }, async () => {
      throw new CliError("configuration_error", "nothing was attempted")
    })

    expect(listRuns(dir)[0]).toMatchObject({ status: "failed", requests: 0, errorCode: "configuration_error" })
  })
})
