import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { afterEach, describe, expect, it } from "vitest"
import { run } from "../program.js"

/**
 * Driving the real command, which is the only way to prove the two promises that are about the
 * command rather than about `diagnose`: the code it exits with, and the fact that it leaves
 * nothing behind.
 *
 * ⚠ **What it prints is not asserted here, and cannot be yet.** `forCommand` builds its own
 * renderer over the real process streams, so `captureStreams` sees commander's own output and
 * nothing a command renders (`CLI-15`, `FIND-53`). A test written against that stdout would pass
 * against an empty string, which is worse than no test. The shape of the answer is covered where
 * it can be — `src/diagnose.test.ts`.
 *
 * The environment is moved rather than injected because `resolveSettings` reads `process.env`
 * directly, and moving it is also what makes this a test of a machine nobody has logged in on.
 */
const moved: string[] = []

const inAnEmptyHome = async (argv: string[]) => {
  const home = mkdtempSync(join(tmpdir(), "max-doctor-cmd-"))
  const before = { ...process.env }
  moved.push(home)

  process.env.MAX_CONFIG_DIR = join(home, "config")
  process.env.MAX_STATE_DIR = join(home, "state")
  process.env.MAX_CACHE_DIR = join(home, "cache")
  process.env.MAX_TOKEN = ""

  const streams = captureStreams()
  try {
    return { home, code: await run(argv, { streams, tty: false }) }
  } finally {
    for (const key of ["MAX_CONFIG_DIR", "MAX_STATE_DIR", "MAX_CACHE_DIR", "MAX_TOKEN"]) {
      if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
}

afterEach(() => {
  for (const home of moved.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("max doctor, as a command", () => {
  it("**answers on a machine with no session, and exits 0**", async () => {
    // The only time anybody runs it is when something is wrong, so a non-zero code for "there is
    // no session" would make it useless for the one question it exists to answer.
    expect((await inAnEmptyHome(["doctor"])).code).toBe(0)
  })

  it("answers the same in machine mode", async () => {
    expect((await inAnEmptyHome(["doctor", "--json"])).code).toBe(0)
  })

  it("**creates nothing** — not the state file it reports on, not the cache", async () => {
    const { home } = await inAnEmptyHome(["doctor"])

    // `SessionStore.readState` invents a device identity and writes it out on first read. A
    // diagnosis that reports on its own side effect is not one.
    expect(existsSync(join(home, "state", "profiles"))).toBe(false)
    expect(existsSync(join(home, "cache"))).toBe(false)
  })

  it("carries the profile from the first word like every other command", async () => {
    const { home, code } = await inAnEmptyHome(["work", "doctor"])

    expect(code).toBe(0)
    expect(readdirSync(home).length).toBe(0)
  })
})
