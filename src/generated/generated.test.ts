import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { operations, reservations, spec } from "../spec/index.js"
import { Opcode } from "./opcodes.generated.js"
import { OPERATIONS } from "./operations.generated.js"

describe("what the generator wrote", () => {
  it("holds every opcode the specification declares, sent or not", () => {
    for (const entry of spec) {
      expect(Opcode[entry.constant as keyof typeof Opcode], entry.name).toBe(entry.opcode)
    }
    expect(Object.keys(Opcode)).toHaveLength(spec.length)
  })

  it("**gives a method only to what may be sent**", () => {
    expect(Object.keys(OPERATIONS)).toHaveLength(operations.length)
    for (const reservation of reservations) {
      expect(Object.keys(OPERATIONS)).not.toContain(reservation.name)
    }
  })

  it("is what `pnpm generate` produces right now", () => {
    const before = files().map((path) => readFileSync(path, "utf8"))
    execFileSync("pnpm", ["generate"], { stdio: "ignore" })

    expect(files().map((path) => readFileSync(path, "utf8"))).toEqual(before)
  }, 60_000)
})

const files = () => [
  "src/generated/opcodes.generated.ts",
  "src/generated/operations.generated.ts",
  "src/generated/client.generated.ts",
  "docs/protocol.md",
  // Not from `src/spec/` but from the command tree (`OPS-10`); the same check guards it, because
  // the failure is the same one — a page that quotes a command the program no longer has.
  "docs/commands.md",
]
