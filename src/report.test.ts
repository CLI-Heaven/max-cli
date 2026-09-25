import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { run } from "./program.js"
import { mailtoFor, type Report } from "./report.js"
import { SessionStore } from "./session/store.js"

const environment: Environment = { store: (profile) => new SessionStore({ profile, keyring: memoryKeyring() }) }

const runWith = async (argv: string[]) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const output = (name: string) => join(process.env.TMPDIR ?? "", name)

describe("max doctor report", () => {
  it("says what a report holds and where it goes, and writes nothing", async () => {
    const { code, stdout } = await runWith(["doctor", "report", "--json"])

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ sendTo: "reports@neirox.ai", create: "max doctor report create" })
    expect(JSON.parse(stdout).excludes).toContain("токена")
  })

  it("with no failed run yet, still writes the report and says how to get one", async () => {
    const file = output("empty.json")
    const { code, stdout, stderr } = await runWith(["doctor", "report", "create", "--output", file, "--json"])

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({ path: file, run: null })
    expect(stderr).toContain("Неудачных запусков не записано")
  })

  it("puts the newest failed run in a file only its owner reads, and a letter to send it with", async () => {
    await runWith(["r-failed", "chats", "list"])
    const file = output("report.json")

    const { code, stdout } = await runWith(["doctor", "report", "create", "--output", file, "--json"])
    const answer = JSON.parse(stdout)
    const report = JSON.parse(readFileSync(file, "utf8")) as Report

    expect(code).toBe(0)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(report.run?.metadata).toMatchObject({
      command: "chats list",
      status: "failed",
      errorCode: "authentication_error",
      keptBecauseFailed: true,
    })
    expect(report).toMatchObject({ runtime: expect.stringMatching(/^(node|bun) /), doctor: expect.any(Object) })
    expect(answer.mailto).toMatch(/^mailto:reports@neirox\.ai\?subject=/)
    expect(answer.steps).toHaveLength(4)
  })

  it("refuses a run that does not exist", async () => {
    const { code } = await runWith(["doctor", "report", "create", "--run", "nope", "--output", output("x.json")])
    expect(code).toBe(6)
  })
})

describe("the letter", () => {
  it("names the version and the failure in the subject, and the file in the body", () => {
    const report = {
      version: "0.10.0",
      runtime: "node 24.1.0",
      platform: "linux",
      arch: "x64",
      run: { metadata: { runId: "r1", command: "chats list", errorCode: "provider_error", maxError: "proto.payload" } },
    } as unknown as Report

    const link = decodeURIComponent(mailtoFor(report, "/tmp/r.json"))

    expect(link).toContain("subject=max 0.10.0: chats list — provider_error")
    expect(link).toContain("run r1: provider_error (proto.payload)")
    expect(link).toContain("Файл отчёта приложен: /tmp/r.json")
  })

  it("hides the home directory", async () => {
    const { buildReport } = await import("./report.js")
    const report = buildReport({
      profile: "p",
      doctor: { session: { stateFile: "/home/someone/.local/state/max-cli/profiles/p.json" } } as never,
      runsDir: output("no-runs"),
      sends: [],
      home: "/home/someone",
    })
    expect(JSON.stringify(report)).not.toContain("/home/someone")
    expect(JSON.stringify(report)).toContain("~/.local/state")
  })
})
