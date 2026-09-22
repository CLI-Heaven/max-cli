import { Readable } from "node:stream"
import { describe, expect, it } from "vitest"
import { readBody } from "./body.js"

const piped = (text: string) => {
  const input = Readable.from([Buffer.from(text, "utf8")]) as Readable & { isTTY?: boolean }
  input.isTTY = false
  return { input }
}

const terminal = () => {
  const input = Readable.from([]) as Readable & { isTTY?: boolean }
  input.isTTY = true
  return { input }
}

describe("a message body from a pipe", () => {
  it("takes what was piped in", async () => {
    expect(await readBody(piped("hello"))).toBe("hello")
  })

  it("**keeps the newlines a multiline message is made of**, which argv cannot carry at all", async () => {
    expect(await readBody(piped("first\nsecond\n\nfourth\n"))).toBe("first\nsecond\n\nfourth")
  })

  it("drops one trailing newline and no more", async () => {
    expect(await readBody(piped("hi\n"))).toBe("hi")
    expect(await readBody(piped("hi\n\n"))).toBe("hi\n")
    expect(await readBody(piped("hi\r\n"))).toBe("hi")
  })

  it("**keeps leading and inner whitespace**, which in a message is content and not formatting", async () => {
    expect(await readBody(piped("  indented\n\tand tabbed\n"))).toBe("  indented\n\tand tabbed")
  })

  it("**refuses a terminal rather than waiting at one**, which would look like a hang", async () => {
    await expect(readBody(terminal())).rejects.toMatchObject({ code: "validation_error" })
    expect(String(await readBody(terminal()).catch((error: Error) => error))).toContain("messages send")
  })

  it("refuses an empty body rather than sending nothing", async () => {
    await expect(readBody(piped(""))).rejects.toMatchObject({ code: "validation_error" })
    await expect(readBody(piped("\n"))).rejects.toMatchObject({ code: "validation_error" })
  })
})
