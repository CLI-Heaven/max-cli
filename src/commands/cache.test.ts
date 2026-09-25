import { captureStreams } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { run } from "../program.js"

const clear = async (argv: string[]) => {
  const streams = captureStreams()
  await run([...argv, "cache", "clear", "--json"], { streams, tty: false })
  return JSON.parse(streams.stdout.join("")) as { profile: string }
}

describe("max cache clear", () => {
  it("clears the default profile when no profile is named", async () => {
    expect((await clear([])).profile).toBe("default")
  })

  it("clears the profile MAX_PROFILE names", async () => {
    process.env.MAX_PROFILE = "cache-env"
    try {
      expect((await clear([])).profile).toBe("cache-env")
    } finally {
      delete process.env.MAX_PROFILE
    }
  })
})
