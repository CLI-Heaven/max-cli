import { readFileSync } from "node:fs"
import type { Command } from "commander"
import { describe, expect, it } from "vitest"
import { createProgram } from "../program.js"

const skill = readFileSync(new URL("../../skills/max-cli/SKILL.md", import.meta.url), "utf8")

const everyCommand = (command: Command): Command[] => [command, ...command.commands.flatMap(everyCommand)]

describe("the skill an agent is given", () => {
  const program = createProgram()
  const commands = everyCommand(program)

  it("**names only flags that exist** — a skill that recommends a missing flag is worse than none", () => {
    const flags = new Set(commands.flatMap((command) => command.options.map((option) => option.long)))
    flags.add("--help")
    const named = [...new Set(skill.match(/--[a-z][a-z-]*/g) ?? [])]

    expect(named.filter((flag) => !flags.has(flag) && flag !== "--profile")).toEqual([])
    expect(flags.has("--profile")).toBe(false)
  })

  it("names only commands that exist", () => {
    const paths = new Set(
      program.commands.flatMap((command) => command.commands.map((sub) => `${command.name()} ${sub.name()}`)),
    )
    const named = [
      ...skill.matchAll(/max (?:[a-z]+ )?((?:session|account|chats|contacts|messages|cache|runs|skill) [a-z]+)/g),
    ].map((match) => match[1] ?? "")

    expect(named.length).toBeGreaterThan(5)
    expect(named.filter((path) => !paths.has(path))).toEqual([])
  })
})
