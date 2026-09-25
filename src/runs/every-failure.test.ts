import { readFileSync } from "node:fs"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "../commands/context.js"
import { run } from "../program.js"
import { SessionStore } from "../session/store.js"
import { listRuns, runsDirFor } from "./run.js"

const environment: Environment = { store: (profile) => new SessionStore({ profile, keyring: memoryKeyring() }) }

const runWith = async (argv: string[]) => {
  const streams = captureStreams()
  return run(argv, { ...environment, streams, tty: false })
}

const runsOf = (profile: string) => listRuns(runsDirFor()).filter((one) => one.profile === profile)

const everythingKeptFor = (profile: string): string =>
  runsOf(profile)
    .map((one) => {
      const dir = join(runsDirFor(), one.startedAt.slice(0, 10), one.runId)
      return readFileSync(join(dir, "run.json"), "utf8") + readFileSync(join(dir, "events.jsonl"), "utf8")
    })
    .join("\n")

describe("every failure is kept as a run", () => {
  it("a usage error, named by the command's words only", async () => {
    expect(await runWith(["f-usage", "messages", "list", "секретный чат", "--bogus"])).not.toBe(0)

    expect(runsOf("f-usage")).toMatchObject([
      { command: "messages list", status: "failed", errorCode: "validation_error", keptBecauseFailed: true },
    ])
    expect(everythingKeptFor("f-usage")).not.toContain("секретный")
  })

  it("a check a command makes before it opens its run", async () => {
    expect(await runWith(["f-check", "backup", "messages", "111"])).toBe(2)
    expect(runsOf("f-check")).toMatchObject([{ command: "backup messages", errorCode: "validation_error" }])
  })

  it("a failure inside a run, once, with nothing it was given", async () => {
    expect(await runWith(["f-inside", "messages", "send", "111", "секретный текст"])).toBe(4)

    expect(runsOf("f-inside")).toMatchObject([{ command: "messages send", errorCode: "authentication_error" }])
    expect(everythingKeptFor("f-inside")).not.toContain("секретный")
  })

  it("a command that never talks to MAX", async () => {
    expect(await runWith(["f-local", "models", "audio", "download", "no-such-model"])).not.toBe(0)
    expect(runsOf("f-local")).toMatchObject([{ command: "models audio download", status: "failed" }])
  })

  it("`session start` refused before anything happened", async () => {
    expect(await runWith(["f-start", "session", "start", "qr"])).toBe(2)
    expect(runsOf("f-start")).toMatchObject([{ command: "session start", errorCode: "validation_error" }])
  })

  it("a first word that names no command and nothing after it", async () => {
    expect(await runWith(["f-alone"])).toBe(2)
    expect(runsOf("f-alone")).toMatchObject([{ command: "max", errorCode: "validation_error" }])
  })

  it("but nothing when recording was turned off by name, or when nothing failed", async () => {
    expect(await runWith(["f-off", "backup", "messages", "111", "--no-record"])).toBe(2)
    expect(await runWith(["f-help", "messages", "--help"])).toBe(0)
    expect(await runWith(["f-help", "doctor", "report"])).toBe(0)

    expect(runsOf("f-off")).toEqual([])
    expect(runsOf("f-help")).toEqual([])
  })
})
