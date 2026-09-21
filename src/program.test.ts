import { captureStreams } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { commandWords, liftProfile } from "./profile.js"
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

  it("offers every resource at the top level", async () => {
    const { stdout } = await runWith(["--help"])
    for (const command of ["session", "account", "chats", "contacts", "messages", "cache", "runs"]) {
      expect(stdout).toContain(command)
    }
  })

  it("**offers a way out of the cache**, because a cache is the one part that remembers being wrong", async () => {
    expect((await runWith(["--help"])).stdout).toContain("--offline")
    expect((await runWith(["cache", "--help"])).stdout).toContain("clear")
  })

  it("**does not offer --no-cache**, because not using the record is already what happens", async () => {
    expect((await runWith(["--help"])).stdout).not.toContain("--no-cache")
  })

  it("reads --offline as a switch the commands can see", () => {
    const program = createProgram()
    program.parseOptions(["--offline"])
    expect(program.opts().offline).toBe(true)

    const untouched = createProgram()
    untouched.parseOptions([])
    expect(untouched.opts().offline).toBeUndefined()
  })

  it("reads a run back three ways, and records nothing while doing it", async () => {
    const { stdout } = await runWith(["runs", "--help"])
    for (const action of ["list", "show", "path"]) expect(stdout).toContain(action)
  })

  it("**tells `--record`, `--no-record` and neither apart**, because the third is the configuration's", () => {
    const asked = createProgram()
    asked.parseOptions(["--record"])
    expect(asked.opts().record).toBe(true)

    const refused = createProgram()
    refused.parseOptions(["--no-record"])
    expect(refused.opts().record).toBe(false)

    // Not `true` and not `false`: nothing on the command line means the configuration file decides,
    // and a default here would quietly outrank it.
    const untouched = createProgram()
    untouched.parseOptions([])
    expect(untouched.opts().record).toBeUndefined()
  })

  it("promises only what `--verbose` actually does", async () => {
    // `commander` wraps the column, so the promise is checked in the piece that survives wrapping.
    const { stdout } = await runWith(["--help"])
    expect(stdout).toContain("ids and timings")
    // It said "without anything that identifies you" until 2026-09-20, and the line names the chat.
    expect(stdout).not.toContain("without anything that identifies you")
  })

  it("**puts the action under the resource, never beside it**", async () => {
    const messages = await runWith(["messages", "--help"])
    expect(messages.stdout).toContain("list")
    expect(messages.stdout).toContain("send")

    // `max send` was a top-level command until 2026-09-19. One rule, no exceptions to remember.
    const gone = await runWith(["send", "0", "hello"])
    expect(gone.stderr).toContain("unknown command")
    expect(gone.code).not.toBe(0)
  })

  it("keeps a subcommand from killing the process on a bad option", async () => {
    const { stdout, stderr, code } = await runWith(["chats", "list", "--nonsense"])
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown option")
    expect(code).not.toBe(0)
  })

  it("carries the global options every command needs", async () => {
    const { stdout } = await runWith(["--help"])
    for (const option of ["--json", "--quiet", "--verbose"]) expect(stdout).toContain(option)
  })

  it("**has no `--profile`, and says in its help where the profile went**", async () => {
    const { stdout } = await runWith(["--help"])
    expect(stdout).not.toContain("--profile")
    expect(stdout).toContain("max [profile]")
    expect(stdout).toContain("The first word is the profile")
    expect(stdout).toContain("MAX_PROFILE")
  })

  it("does not mistake a command for a profile", () => {
    const program = createProgram()
    expect(liftProfile(["chats", "list"], commandWords(program)).profile).toBeUndefined()
    expect(liftProfile(["personal", "chats", "list"], commandWords(program)).profile).toBe("personal")
  })

  it("sends an unknown option to stderr and exits non-zero", async () => {
    const { stdout, stderr, code } = await runWith(["--nonsense"])
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown option")
    expect(code).not.toBe(0)
  })

  it("**puts a failure on stderr as JSON, never on stdout**", async () => {
    const { stdout, stderr, code } = await runWith(["a-profile-that-does-not-exist", "account", "show", "--json"])

    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("authentication_error")
    // 4 is authentication_error in cli-core's table: a script branches on this, not on the text.
    expect(code).toBe(4)
  })

  it("tells a person what to do next, **naming the profile they actually typed**", async () => {
    const streams = captureStreams()
    const code = await run(["a-profile-that-does-not-exist", "account", "show"], { streams, tty: true })

    expect(streams.stdout).toEqual([])
    expect(streams.stderr.join("")).toContain("max a-profile-that-does-not-exist session start")
    expect(code).toBe(4)
  })

  it("**refuses a profile with no command instead of printing help on stdout**", async () => {
    // `max me` — renamed away on 2026-09-19 — is now the profile `me` and nothing else. Commander
    // answers a missing command with help on stdout, which a script cannot tell from a result.
    const { stdout, stderr, code } = await runWith(["me"])

    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("validation_error")
    expect(JSON.parse(stderr).error.message).toContain("read as a profile name")
    expect(code).toBe(2)
  })

  it("explains itself when the first word was a mistyped command", async () => {
    // `max chat list` — one letter short. Without this line the only message is "unknown command
    // 'list'", which names the wrong word entirely.
    const { stderr, code } = await runWith(["chat", "list"])

    expect(stderr).toContain("unknown command 'list'")
    expect(stderr).toContain('"chat" is not a command, so it was read as a profile name')
    expect(code).not.toBe(0)
  })
})
