import { describe, expect, it } from "vitest"
import { operations, reservations, spec } from "./index.js"

const duplicates = <T>(values: T[]): T[] => values.filter((value, index) => values.indexOf(value) !== index)

describe("the specification", () => {
  it("gives every opcode, name and constant exactly one meaning", () => {
    expect(duplicates(spec.map((entry) => entry.opcode))).toEqual([])
    expect(duplicates(spec.map((entry) => entry.name))).toEqual([])
    expect(duplicates(spec.map((entry) => entry.constant))).toEqual([])
  })

  it("**refuses a request field nobody has seen, and keeps one a response grew**", () => {
    for (const operation of operations) {
      expect(operation.request.type, operation.name).toBe("strict_object")
      expect(operation.response.type, operation.name).toBe("loose_object")
    }
  })

  it("says where every shape came from", () => {
    for (const entry of spec) {
      expect(entry.provenance.sources.length, entry.name).toBeGreaterThan(0)
    }
  })

  it("**gives a reserved opcode a reason, because that is the whole entry**", () => {
    expect(reservations.length).toBeGreaterThan(0)
    for (const reservation of reservations) {
      expect(reservation.reason.length, reservation.name).toBeGreaterThan(40)
    }
  })

  it("names an operation by subject and a constant by what MAX calls it", () => {
    for (const operation of operations) {
      expect(operation.name, operation.name).toMatch(/^[a-z]+\.[a-zA-Z0-9]+$/)
      expect(operation.constant, operation.name).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})
