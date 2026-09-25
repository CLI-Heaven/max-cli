import { PassThrough, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { readSecret } from "./prompt.js"

const capture = () => {
  const written: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk))
      done()
    },
  })
  return { stream, text: () => written.join("") }
}

describe("readSecret", () => {
  it("takes a piped secret and trims it", async () => {
    const input = new PassThrough()
    input.end("piped-secret\n")

    expect(await readSecret("MAX token: ", { input, output: capture().stream })).toBe("piped-secret")
  })

  it("**never echoes what was typed**", async () => {
    const input = new PassThrough() as PassThrough & { isTTY: boolean }
    input.isTTY = true
    const output = capture()

    const answer = readSecret("MAX token: ", { input, output: output.stream })
    setImmediate(() => input.write("typed-secret\n"))

    expect(await answer).toBe("typed-secret")
    expect(output.text()).toContain("MAX token: ")
    expect(output.text()).not.toContain("typed-secret")
  })

  it.each([
    ["Ctrl-C", (input: PassThrough) => input.write("\u0003")],
    ["a closed terminal", (input: PassThrough) => input.end()],
  ])("gives up with `cancelled` on %s, rather than wait for ever", async (_, stop) => {
    const input = new PassThrough() as PassThrough & { isTTY: boolean }
    input.isTTY = true

    const answer = readSecret("MAX token: ", { input, output: capture().stream })
    setImmediate(() => stop(input))

    await expect(answer).rejects.toMatchObject({ code: "cancelled" })
  })
})
