import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, EXIT_CODES } from "@leemour/cli-core"
import type { CommandInfo } from "@leemour/cli-core/commands"
import type { Command } from "commander"
import { describe, expect, it } from "vitest"
import { createProgram, run } from "../program.js"

const commands = async (argv: string[] = ["commands", "--json"], tty = false) => {
  const streams = captureStreams()
  const code = await run(argv, { streams, tty })
  return { code, stdout: streams.stdout, stderr: streams.stderr }
}

const leaves = (command: Command, path: string[] = []): string[] =>
  command.commands.flatMap((child) =>
    child.commands.length === 0 ? [[...path, child.name()].join(" ")] : leaves(child, [...path, child.name()]),
  )

const flat = (tree: readonly CommandInfo[]): CommandInfo[] => tree.flatMap((one) => [one, ...flat(one.commands)])

describe("max commands", () => {
  it("puts one JSON value on stdout and nothing else", async () => {
    const { code, stdout, stderr } = await commands()
    expect(code).toBe(0)
    expect(stdout).toHaveLength(1)
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout[0] as string).cli).toBe("max")
  })

  it("lists every command the program has, with the argv path already split", async () => {
    const { stdout } = await commands()
    const listed = flat(JSON.parse(stdout[0] as string).commands)
      .filter((command) => command.commands.length === 0)
      .map((command) => command.path.join(" "))
    expect(listed.sort()).toEqual(leaves(createProgram()).sort())
  })

  it("marks the commands that change something in MAX, and only those", async () => {
    const { stdout } = await commands()
    const writing = flat(JSON.parse(stdout[0] as string).commands)
      .filter((command) => command.mutates)
      .map((command) => command.path.join(" "))
    expect(writing).toEqual(["messages send", "reactions add"])
  })

  it("publishes the exit code for every failure a script branches on", async () => {
    const { stdout } = await commands()
    expect(JSON.parse(stdout[0] as string).exitCodes).toMatchObject({ ok: 0, ...EXIT_CODES })
  })

  it("needs no session and survives a configuration file it cannot read", async () => {
    const home = mkdtempSync(join(tmpdir(), "max-commands-"))
    const before = process.env.MAX_CONFIG_DIR
    process.env.MAX_CONFIG_DIR = home
    writeFileSync(join(home, "config.json"), "{ not json")
    try {
      expect((await commands()).code).toBe(0)
    } finally {
      if (before === undefined) delete process.env.MAX_CONFIG_DIR
      else process.env.MAX_CONFIG_DIR = before
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("shows a person a flat table instead of the tree", async () => {
    const { code, stdout } = await commands(["commands"], true)
    expect(code).toBe(0)
    expect(stdout.join("\n")).toContain("max messages send <chat> [text] [options]")
    expect(stdout.join("\n")).not.toContain('"commands"')
  })
})
