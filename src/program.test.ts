import { captureStreams } from "@cli-heaven/cli-core"
import { describe, expect, it } from "vitest"
import { createProgram, run } from "./program.js"

const runWith = async (argv: string[]) => {
  const streams = captureStreams()
  const code = await run(argv, { streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

describe("the program", () => {
  it("prints a version, and prints it on stdout", async () => {
    const { stdout, stderr, code } = await runWith(["--version"])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(stderr).toBe("")
    expect(code).toBe(0)
  })

  it("is called max, whatever the package is called", async () => {
    expect((await runWith(["--help"])).stdout).toContain("Usage: max")
  })

  it("offers the whole slice", async () => {
    const { stdout } = await runWith(["--help"])
    for (const command of ["login", "me", "chats", "messages", "logout"]) expect(stdout).toContain(command)
  })

  it("carries the four global options every command needs", async () => {
    const { stdout } = await runWith(["--help"])
    for (const option of ["--profile", "--json", "--quiet", "--verbose"]) expect(stdout).toContain(option)
  })

  it("defaults to the default profile rather than to nothing", () => {
    const program = createProgram()
    program.parseOptions([])
    expect(program.opts().profile).toBe("default")
  })

  it("sends an unknown option to stderr and exits non-zero", async () => {
    const { stdout, stderr, code } = await runWith(["--nonsense"])
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown option")
    expect(code).not.toBe(0)
  })

  it("**puts a failure on stderr as JSON, never on stdout**", async () => {
    const { stdout, stderr, code } = await runWith(["me", "--json", "--profile", "a-profile-that-does-not-exist"])

    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("authentication_error")
    // 4 is authentication_error in cli-core's table: a script branches on this, not on the text.
    expect(code).toBe(4)
  })

  it("tells a person what to do next, rather than printing JSON at them", async () => {
    const streams = captureStreams()
    const code = await run(["me", "--profile", "a-profile-that-does-not-exist"], { streams, tty: true })

    expect(streams.stdout).toEqual([])
    expect(streams.stderr.join("")).toContain("max login")
    expect(code).toBe(4)
  })
})
