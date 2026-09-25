import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runUpdate, type UpdateEnvironment, updateNotice } from "./update.js"

const PNPM =
  "/home/a/.local/share/pnpm/store/v11/links/@leemour/max-cli/0.6.0/x/node_modules/@leemour/max-cli/dist/update.js"

const setup = (latest: string | Error = "99.0.0") => {
  const home = mkdtempSync(join(tmpdir(), "max-update-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MAX_NO_UPDATE_CHECK: undefined,
    CI: undefined,
    MAX_STATE_DIR: join(home, "state"),
    MAX_CONFIG_DIR: join(home, "config"),
  }
  let asked = 0
  let now = 1_000_000
  const environment: UpdateEnvironment = {
    scriptPath: PNPM,
    stderrIsTTY: true,
    now: () => now,
    fetch: async () => {
      asked += 1
      if (latest instanceof Error) throw latest
      return new Response(JSON.stringify({ version: latest }))
    },
  }
  const notice = (argv = ["chats", "list"], tty = true) => updateNotice(argv, { tty, environment, env })
  return { env, home, notice, asked: () => asked, later: (ms: number) => (now += ms) }
}

describe("the daily line about a newer version", () => {
  it("tells a person at a terminal that a newer version exists", async () => {
    expect(await setup().notice()).toMatch(/max 99\.0\.0 is out — you have .+ `max update` installs it/)
  })

  it("tells nobody reading JSON, a pipe, --quiet or CI — and then does not ask npm at all", async () => {
    const { notice, asked, env } = setup()
    expect(await notice(["chats", "list", "--json"])).toBeUndefined()
    expect(await notice(["chats", "list"], false)).toBeUndefined()
    expect(await notice(["chats", "list", "--quiet"])).toBeUndefined()
    env.CI = "true"
    expect(await notice()).toBeUndefined()
    expect(asked()).toBe(0)
  })

  it("asks npm at most once a day, and keeps telling from what it last heard", async () => {
    const { notice, asked, later } = setup()
    await notice()
    later(60 * 60 * 1000)
    expect(await notice()).toMatch(/99\.0\.0/)
    expect(asked()).toBe(1)
    later(24 * 60 * 60 * 1000)
    await notice()
    expect(asked()).toBe(2)
  })

  it("says nothing, and fails nothing, when npm cannot be reached", async () => {
    expect(await setup(new Error("offline")).notice()).toBeUndefined()
  })

  it("says nothing when the version in use is the newest", async () => {
    expect(await setup("0.0.1").notice()).toBeUndefined()
  })

  it("stays off when the defaults say updateCheck: false", async () => {
    const { notice, env, asked } = setup()
    mkdirSync(env.MAX_CONFIG_DIR as string, { recursive: true })
    writeFileSync(
      join(env.MAX_CONFIG_DIR as string, "config.json"),
      JSON.stringify({ defaults: { updateCheck: false } }),
    )
    expect(await notice()).toBeUndefined()
    expect(asked()).toBe(0)
  })

  it("never runs for a Tab or for max update itself", async () => {
    const { notice, asked } = setup()
    expect(await notice(["complete", "--", "ch"])).toBeUndefined()
    expect(await notice(["update"])).toBeUndefined()
    expect(await notice(["--timeout", "30s", "update"])).toBeUndefined()
    expect(asked()).toBe(0)
  })
})

describe("starting the package manager", () => {
  it("really starts npm on this platform", () => {
    expect(runUpdate(["npm", "--version"])).toBe(0)
  })

  it("fails loudly when the package manager cannot be started", () => {
    // Windows starts it through cmd, which reports a missing program as exit 1 on stderr, not as an error.
    if (process.platform === "win32") expect(runUpdate(["max-cli-no-such-installer", "--version"])).not.toBe(0)
    else expect(() => runUpdate(["max-cli-no-such-installer", "--version"])).toThrow(/max-cli-no-such-installer/)
  })
})
