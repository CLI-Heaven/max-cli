import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { run } from "./program.js"
import { issueUrlFor, type Report } from "./report.js"
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
    expect(JSON.parse(stdout)).toMatchObject({
      sendTo: "https://github.com/leemour/max-cli/issues/new",
      create: "max doctor report create",
    })
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
    // Windows has no owner-only mode bits.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(report.run?.metadata).toMatchObject({
      command: "chats list",
      status: "failed",
      errorCode: "authentication_error",
      keptBecauseFailed: true,
    })
    expect(report).toMatchObject({ runtime: expect.stringMatching(/^(node|bun) /), doctor: expect.any(Object) })
    expect(answer.issue).toMatch(/^https:\/\/github\.com\/leemour\/max-cli\/issues\/new\?title=/)
    expect(answer.steps).toHaveLength(4)
  })

  it("refuses a run that does not exist", async () => {
    const { code } = await runWith(["doctor", "report", "create", "--run", "nope", "--output", output("x.json")])
    expect(code).toBe(6)
  })
})

describe("the new issue", () => {
  it("names the version and the failure in the title, and only the file's name in the body", () => {
    const report = {
      version: "0.10.0",
      runtime: "node 24.1.0",
      platform: "linux",
      arch: "x64",
      run: { metadata: { runId: "r1", command: "chats list", errorCode: "provider_error", maxError: "proto.payload" } },
    } as unknown as Report

    const link = decodeURIComponent(issueUrlFor(report, "/home/someone/r.json"))

    expect(link).toContain("title=max 0.10.0: chats list — provider_error")
    expect(link).toContain("run r1: provider_error (proto.payload)")
    expect(link).toContain("Файл отчёта: r.json")
    expect(link).not.toContain("/home/someone")
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

  it("hides a Windows home directory in any case, and leaves out the quoted fix lines", async () => {
    const { buildReport } = await import("./report.js")
    const report = buildReport({
      profile: "p",
      doctor: {
        session: { stateFile: "C:\\Users\\O'Neil Smith\\AppData\\Roaming\\max-cli\\profiles\\p.json" },
        install: {
          binDir: "C:/Users/O'Neil Smith/AppData/Roaming/npm",
          onPath: "C:\\USERS\\O'NEIL SMITH\\APPDATA\\ROAMING\\NPM\\max.cmd",
          fix: ["$env:Path = 'C:\\Users\\O''Neil Smith\\AppData\\Roaming\\npm' + ';' + $env:Path"],
        },
      } as never,
      runsDir: output("no-runs"),
      sends: [],
      home: "C:\\Users\\O'Neil Smith",
    })
    expect(JSON.stringify(report).toLowerCase()).not.toContain("neil")
    expect(report.doctor.session.stateFile).toBe("~\\AppData\\Roaming\\max-cli\\profiles\\p.json")
  })

  it("replaces chat and message ids with labels that match inside one report and nowhere else", async () => {
    const { buildReport } = await import("./report.js")
    const runsDir = output("labelled-runs")
    const dir = join(runsDir, "2026-09-25", "run-1")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "run.json"),
      JSON.stringify({
        runId: "run-1",
        command: "messages send",
        profile: "p",
        startedAt: "",
        status: "failed",
        cliVersion: "",
      }),
    )
    writeFileSync(
      join(dir, "events.jsonl"),
      `${JSON.stringify({ event: "request", ids: { chat: "4242", message: "99", cid: "7" } })}\n`,
    )
    const sends = [{ at: "", profile: "p", chatId: "4242", messageId: "99", outcome: "sent" as const }]
    const build = () =>
      buildReport({ profile: "p", doctor: { session: {} } as never, runsDir, runId: "run-1", sends, home: "/nowhere" })

    const report = build()
    const ids = report.run?.events[0]?.ids as Record<string, string>

    expect(JSON.stringify(report)).not.toMatch(/4242|"99"/)
    expect(ids.chat).toMatch(/^id:[0-9a-f]{12}$/)
    expect(report.sends[0]?.chatId).toBe(ids.chat)
    expect(report.sends[0]?.messageId).toBe(ids.message)
    expect(ids.cid).toBe("7")
    expect(build().sends[0]?.chatId).not.toBe(ids.chat)
  })
})
