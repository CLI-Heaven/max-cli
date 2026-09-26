import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { afterEach, describe, expect, it } from "vitest"
import { run } from "../program.js"
import { SessionStore } from "../session/store.js"
import { installNotes } from "./doctor.js"

/**
 * Driving the real command, which since `CLI-15` can be read: `run` is handed the streams and the
 * store, so what `doctor` prints is assertable rather than only what commander prints.
 *
 * The three directory variables are moved rather than injected because `resolveSettings` reads
 * `process.env` directly for those — and moving them is also what makes each case a machine
 * nobody has logged in on.
 */
const homes: string[] = []

const inAnEmptyHome = async (argv: string[], { token = false, loggedIn = false, tty = false } = {}) => {
  const home = mkdtempSync(join(tmpdir(), "max-doctor-cmd-"))
  const before = { ...process.env }
  homes.push(home)

  process.env.MAX_CONFIG_DIR = join(home, "config")
  process.env.MAX_STATE_DIR = join(home, "state")
  process.env.MAX_CACHE_DIR = join(home, "cache")
  delete process.env.MAX_TOKEN

  const keyring = memoryKeyring()
  const streams = captureStreams()
  try {
    const code = await run(argv, {
      streams,
      tty,
      store: (profile) => {
        const store = new SessionStore({ profile, keyring })
        if (token) store.writeToken("a-token")
        if (loggedIn) store.writeState({ deviceId: "a-device", logins: 2 })
        return store
      },
    })
    return { home, code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
  } finally {
    for (const key of ["MAX_CONFIG_DIR", "MAX_STATE_DIR", "MAX_CACHE_DIR", "MAX_TOKEN"]) {
      if (before[key] === undefined) delete process.env[key]
      else process.env[key] = before[key]
    }
  }
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("max doctor", () => {
  it("**answers on a machine with no session, and exits 0**", async () => {
    // The only time anybody runs it is when something is wrong, so a non-zero code for "there is
    // no session" would make it useless for the one question it exists to answer.
    const { code, stdout } = await inAnEmptyHome(["doctor", "--json"])

    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toMatchObject({
      token: { present: false, from: "none" },
      session: { exists: false },
      cache: { exists: false },
    })
  })

  it("blames the keyring, not the session, when a profile that has logged in has no token", async () => {
    const { code, stderr } = await inAnEmptyHome(["doctor", "--json"], { loggedIn: true })

    expect(code).toBe(0)
    expect(stderr).toContain("keyring is probably out of reach")
    expect(stderr).not.toContain("session start")
  })

  it("says the token is there and where from, and **never what it is**", async () => {
    const { stdout } = await inAnEmptyHome(["doctor", "--json"], { token: true })

    expect(JSON.parse(stdout).token).toEqual({ present: true, from: "keyring" })
    expect(stdout).not.toContain("a-token")
  })

  it("**names the keyring entry the environment moved** — the failure with no other symptom", async () => {
    const { stdout, stderr } = await inAnEmptyHome(["doctor", "--json"])

    expect(JSON.parse(stdout).keyring.movedByEnvironment).toBe(true)
    expect(stderr).toContain("MAX_CONFIG_DIR")
  })

  it("prints rows for a person and the object for a machine, from the same report", async () => {
    // A pipe is a script until proven otherwise, so only an actual terminal gets the table.
    const person = await inAnEmptyHome(["doctor"], { tty: true })
    expect(person.stdout).toContain("profile")
    expect(person.stdout).not.toContain("movedByEnvironment")

    const machine = await inAnEmptyHome(["doctor"])
    expect(JSON.parse(machine.stdout).keyring).toHaveProperty("movedByEnvironment")
  })

  it("**creates nothing** — not the state file it reports on, not the cache", async () => {
    // `SessionStore.readState` invents a device identity and writes it out on first read. A
    // diagnosis that reports on its own side effect is not one.
    const { home } = await inAnEmptyHome(["doctor"])

    expect(existsSync(join(home, "state", "profiles"))).toBe(false)
    expect(existsSync(join(home, "cache"))).toBe(false)
  })

  it("carries the profile from the first word like every other command", async () => {
    const { code, stdout } = await inAnEmptyHome(["work", "doctor", "--json"])

    expect(code).toBe(0)
    expect(JSON.parse(stdout).session.stateFile).toContain("work.json")
  })
})

describe("what doctor says about the installation", () => {
  const diagnosis = (install: object, native = { keyring: "ok", sqlite: "ok" }) =>
    ({
      install: {
        runtime: { version: "node 24", path: "node" },
        installer: "npm",
        binDir: null,
        binDirOnPath: null,
        onPath: null,
        isMaxCli: null,
        fix: [],
        ...install,
      },
      native,
    }) as never

  const notes = (report: never) => {
    const said: string[] = []
    installNotes(report, (message) => said.push(message))
    return said
  }

  it("says nothing when max is on PATH and everything loads", () => {
    expect(notes(diagnosis({ binDir: "/b", binDirOnPath: true, onPath: "/b/max", isMaxCli: true }))).toEqual([])
  })

  it("prints both PowerShell lines when the command directory is not on PATH", () => {
    const [said] = notes(
      diagnosis({ binDir: "C:\\npm", binDirOnPath: false, fix: ["$env:Path = …", "[Environment]::…"] }),
    )

    expect(said).toContain("C:\\npm, which is not on PATH")
    expect(said).toContain("  $env:Path = …\n  [Environment]::…")
    expect(said).toContain("then open a new terminal")
  })

  it("names another program called max, and what fails to load", () => {
    const said = notes(diagnosis({ onPath: "/opt/max", isMaxCli: false }, { keyring: "no build for x", sqlite: "ok" }))

    expect(said).toEqual([
      expect.stringContaining("/opt/max, another program"),
      expect.stringContaining("no build for x"),
    ])
  })

  it("under npx with no max on PATH, says how to install one", () => {
    expect(notes(diagnosis({ installer: "npx" }))).toEqual([expect.stringContaining("npm install -g @leemour/max-cli")])
  })
})
