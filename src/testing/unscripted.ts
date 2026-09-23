import { afterEach } from "vitest"
import { Opcode } from "../generated/opcodes.generated.js"
import { takeBuiltMocks } from "./mock-max.js"

const names = new Map<number, string>(Object.entries(Opcode).map(([name, opcode]) => [opcode, name]))

/**
 * **A request the scripted MAX has no answer for fails the test that made it.** Without this the
 * mock stays silent, the client times out, and the test fails — if at all — on a symptom three
 * steps downstream. A test that means a request to go unanswered scripts it as `() => undefined`.
 */
afterEach(() => {
  const unscripted = takeBuiltMocks().flatMap((max) => max.unexpected)
  if (unscripted.length === 0) return

  const listed = unscripted.map((opcode) => `${names.get(opcode) ?? "unknown"} (${opcode})`).join(", ")
  throw new Error(
    `the scripted MAX was asked for ${listed} and has no answer scripted — add one, or script silence ` +
      "with `() => undefined` if the test means the request to go unanswered",
  )
})
