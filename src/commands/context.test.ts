import { Command } from "commander"
import { describe, expect, it } from "vitest"
import { forCommand } from "./context.js"

const commandWith = (values: Record<string, unknown>): Command => {
  const command = new Command()
  for (const [key, value] of Object.entries(values)) command.setOptionValue(key, value)
  return command
}

describe("a command's context", () => {
  it("gives the deadline the clients it built, so they can be shut when it fires", async () => {
    const context = forCommand(commandWith({ timeout: "40ms" }))
    context.createClient()
    context.createClient()

    const failure = await context.run("test", () => new Promise<never>(() => {})).catch((error: Error) => error)

    // What the deadline then does with them is `deadline.test.ts`; what matters here is that a
    // client built inside a command is reachable from outside it at all.
    expect(failure).toMatchObject({ code: "timeout" })
  })

  it("runs a command unbounded when no timeout was given", async () => {
    expect(await forCommand(commandWith({})).run("test", async () => "done")).toBe("done")
  })
})
