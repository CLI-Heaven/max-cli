import { describe, expect, it } from "vitest"
import { createProgram } from "./program.js"

const run = async (argv: string[]) => {
  const stdout: string[] = []
  const stderr: string[] = []
  const program = createProgram({ out: (text) => stdout.push(text), err: (text) => stderr.push(text) })
  program.exitOverride()

  try {
    await program.parseAsync(["node", "max", ...argv])
  } catch {
    // Commander throws instead of exiting once exitOverride is on; the streams hold the answer.
  }

  return { stdout: stdout.join(""), stderr: stderr.join("") }
}

describe("the program", () => {
  it("prints a version, and prints it on stdout", async () => {
    const { stdout, stderr } = await run(["--version"])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(stderr).toBe("")
  })

  it("is called max, whatever the package is called", async () => {
    const { stdout } = await run(["--help"])
    expect(stdout).toContain("Usage: max")
  })

  it("carries the four global options every command needs", async () => {
    const { stdout } = await run(["--help"])
    for (const option of ["--profile", "--json", "--quiet", "--verbose"]) expect(stdout).toContain(option)
  })

  it("defaults to the default profile rather than to nothing", async () => {
    const program = createProgram()
    program.parseOptions([])
    expect(program.opts().profile).toBe("default")
  })

  it("sends an unknown option to stderr, not stdout — nothing pollutes machine output", async () => {
    const { stdout, stderr } = await run(["--nonsense"])
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown option")
  })
})
