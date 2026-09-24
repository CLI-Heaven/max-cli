import { captureStreams } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { run } from "../program.js"
import type { UpdateEnvironment } from "../update.js"

const PNPM =
  "/home/a/.local/share/pnpm/store/v11/links/@leemour/max-cli/0.6.0/x/node_modules/@leemour/max-cli/dist/update.js"

const update = async (argv: string[], { latest = "99.0.0", scriptPath = PNPM, exit = 0 } = {}) => {
  const ran: string[][] = []
  const environment: UpdateEnvironment = {
    scriptPath,
    fetch: async () => new Response(JSON.stringify({ version: latest })),
    spawn: (command) => {
      ran.push(command)
      return exit
    },
  }
  const streams = captureStreams()
  const code = await run(["update", ...argv, "--json"], { streams, update: environment })
  const [out] = streams.stdout
  return { code, ran, result: out ? JSON.parse(out) : undefined, stderr: streams.stderr.join("\n") }
}

describe("max update", () => {
  it("--check says what it would run and runs nothing", async () => {
    const { code, ran, result } = await update(["--check"])
    expect(code).toBe(0)
    expect(ran).toEqual([])
    expect(result).toMatchObject({
      latest: "99.0.0",
      newer: true,
      installer: "pnpm",
      command: "pnpm add -g @leemour/max-cli@latest",
      updated: false,
    })
  })

  it("runs the package manager that installed max, and says it did", async () => {
    const { code, ran, result } = await update([])
    expect(code).toBe(0)
    expect(ran).toEqual([["pnpm", "add", "-g", "@leemour/max-cli@latest"]])
    expect(result).toMatchObject({ updated: true })
  })

  it("runs nothing when this is already the newest", async () => {
    const { ran, result } = await update([], { latest: "0.0.1" })
    expect(ran).toEqual([])
    expect(result).toMatchObject({ newer: false, updated: false })
  })

  it("runs nothing for a checkout, and says what to do instead", async () => {
    const { ran, result, stderr } = await update([], { scriptPath: "/home/a/Projects/max-cli/dist/update.js" })
    expect(ran).toEqual([])
    expect(result).toMatchObject({ installer: "checkout", command: null, updated: false })
    expect(stderr).toContain("git pull")
  })

  it("fails with the package manager's exit code named, and does not claim an update", async () => {
    const { code, result, stderr } = await update([], { exit: 7 })
    expect(code).not.toBe(0)
    expect(result).toBeUndefined()
    expect(stderr).toContain("exited with 7")
  })
})
