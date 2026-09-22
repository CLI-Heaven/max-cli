import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findRun, listRuns, pruneRuns, readEvents, startRun } from "./run.js"

const runsDir = () => join(mkdtempSync(join(tmpdir(), "max-runs-")), "runs")

const begin = (dir: string, command = "chats list", now?: () => Date) =>
  startRun({
    runsDir: dir,
    command,
    profile: "default",
    cliVersion: "0.0.0",
    ...(now ? { now } : {}),
  })

describe("a run directory", () => {
  it("exists before the command does anything, and says it is running", async () => {
    const dir = runsDir()
    const run = begin(dir)

    const metadata = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")) as Record<string, unknown>
    expect(metadata).toMatchObject({ command: "chats list", profile: "default", status: "running" })
    expect(metadata.completedAt).toBeUndefined()

    await run.logger.close()
  })

  it("is named so that it sorts, and reads without being opened", async () => {
    const run = begin(runsDir(), "messages send", () => new Date("2026-09-20T08:44:31.123Z"))

    expect(run.id).toMatch(/^20260920T084431Z-messages-send-[0-9a-f]{6}$/)
    expect(run.dir).toContain(join("2026-09-20", run.id))

    await run.logger.close()
  })

  it("**is readable by nobody else** — the directory as much as the file", async () => {
    const run = begin(runsDir())

    expect(statSync(run.dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(run.dir, "run.json")).mode & 0o777).toBe(0o600)
    expect(statSync(join(run.dir, "events.jsonl")).mode & 0o777).toBe(0o600)

    await run.logger.close()
  })

  it("writes one JSON object per event, and no colour ever", async () => {
    const run = begin(runsDir())
    run.logger.info({ event: "request", operation: "chats.history", opcode: 49, seq: 3 })
    run.logger.info({ event: "response", operation: "chats.history", opcode: 49, seq: 3, durationMs: 12 })
    await run.finish("success", { requests: 1 })

    const events = readEvents(run.dir)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      event: "request",
      operation: "chats.history",
      runId: run.id,
      command: "chats list",
    })
    // biome-ignore lint/suspicious/noControlCharactersInRegex: an escape sequence is what must not be there.
    expect(readFileSync(join(run.dir, "events.jsonl"), "utf8")).not.toMatch(/\u001b\[/)
  })

  it("records how it ended, how long it took and how many requests it made", async () => {
    const run = begin(runsDir())
    await run.finish("failed", { requests: 2, errorCode: "authentication_error" })

    const metadata = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")) as Record<string, unknown>
    expect(metadata).toMatchObject({ status: "failed", requests: 2, errorCode: "authentication_error" })
    expect(metadata.completedAt).toBeTypeOf("string")
    expect(metadata.durationMs).toBeTypeOf("number")
  })

  it("finishes once, whoever calls it twice", async () => {
    const run = begin(runsDir())
    await run.finish("success", { requests: 1 })
    await run.finish("failed", { requests: 99 })

    expect(JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8"))).toMatchObject({ status: "success" })
  })
})

describe("reading runs back", () => {
  it("lists them newest first and finds one by id", async () => {
    const dir = runsDir()
    const older = begin(dir, "chats list", () => new Date("2026-09-18T10:00:00.000Z"))
    await older.finish("success", { requests: 2 })
    const newer = begin(dir, "messages send", () => new Date("2026-09-20T10:00:00.000Z"))
    await newer.finish("failed", { requests: 1 })

    expect(listRuns(dir).map((run) => run.command)).toEqual(["messages send", "chats list"])
    expect(findRun(dir, older.id)?.metadata.command).toBe("chats list")
    expect(findRun(dir, "no-such-run")).toBeUndefined()
  })

  it("answers with nothing at all when nothing was ever recorded", () => {
    expect(listRuns(join(tmpdir(), "max-runs-that-do-not-exist"))).toEqual([])
  })

  it("keeps the readable part of a log a killed process left half-written", async () => {
    const run = begin(runsDir())
    writeFileSync(join(run.dir, "events.jsonl"), '{"event":"request","seq":1}\n{"event":"resp')

    expect(readEvents(run.dir)).toEqual([{ event: "request", seq: 1 }])

    await run.logger.close()
  })
})

describe("what is kept, and for how long", () => {
  it("**removes a day past the horizon and keeps everything inside it**", () => {
    const dir = runsDir()
    for (const date of ["2026-08-01", "2026-09-19", "2026-09-20"]) mkdirSync(join(dir, date), { recursive: true })

    const removed = pruneRuns(dir, { keepDays: 30, now: new Date("2026-09-20T10:00:00.000Z") })

    expect(removed).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(["2026-09-19", "2026-09-20"])
  })

  it("leaves alone anything that is not a day", () => {
    const dir = runsDir()
    mkdirSync(join(dir, "notes"), { recursive: true })
    mkdirSync(join(dir, "2020-01-01"), { recursive: true })

    pruneRuns(dir, { keepDays: 1, now: new Date("2026-09-20T10:00:00.000Z") })

    expect(readdirSync(dir)).toEqual(["notes"])
  })

  it("prunes as a recorded run starts, and not otherwise", async () => {
    const dir = runsDir()
    mkdirSync(join(dir, "2020-01-01"), { recursive: true })

    const run = begin(dir)

    expect(readdirSync(dir)).not.toContain("2020-01-01")

    await run.logger.close()
  })
})
