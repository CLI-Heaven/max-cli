import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { SCHEMA_VERSION } from "./cache/schema.js"
import { diagnose } from "./diagnose.js"

let home: string

const at = (...parts: string[]) => join(home, ...parts)

const withState = (profile: string, state: Record<string, unknown>) => {
  mkdirSync(at("state", "profiles"), { recursive: true })
  writeFileSync(at("state", "profiles", `${profile}.json`), JSON.stringify(state))
}

const look = (over = {}) =>
  diagnose({ profile: "default", env: {}, stateDir: at("state"), cacheDir: at("cache"), ...over })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "max-doctor-"))
})

describe("what a command depends on", () => {
  it("**answers on a machine where nothing exists**, which is when it is run", async () => {
    const report = await look()

    expect(report.session.exists).toBe(false)
    expect(report.token).toEqual({ present: false, from: "none" })
    expect(report.cache.exists).toBe(false)
    expect(report.loggedInProfiles).toEqual([])
  })

  it("**does not create the state file it reports on**", async () => {
    await look()

    // `SessionStore.readState` invents a device identity and writes it out on first read. A
    // diagnosis that does that is reporting on its own side effect.
    expect((await look()).session.exists).toBe(false)
  })

  it("reads the login count and the last login, which is what RISK-2 wants counted", async () => {
    withState("default", { deviceId: "d", viewerId: "v", logins: 7, lastLoginAt: "2026-09-23T10:00:00.000Z" })
    const report = await look()

    expect(report.session).toMatchObject({ exists: true, deviceId: true, viewerId: true, logins: 7 })
    expect(report.session.lastLoginAt).toBe("2026-09-23T10:00:00.000Z")
  })

  it("reports the web client version we present, fresh until 60 days after it was read", async () => {
    const readOn = Date.parse((await look()).client.readOn)
    const daysLater = (days: number) => () => new Date(readOn + days * 86_400_000)

    expect((await look({ now: daysLater(60) })).client).toMatchObject({ ageDays: 60, stale: false })
    expect((await look({ now: daysLater(61) })).client).toMatchObject({ ageDays: 61, stale: true })
  })

  it("treats a state file that is not JSON as no session, rather than throwing", async () => {
    mkdirSync(at("state", "profiles"), { recursive: true })
    writeFileSync(at("state", "profiles", "default.json"), "{ not json")

    expect((await look()).session.exists).toBe(false)
  })

  it("**lists the profiles that are logged in**, which is not the list `config show` can give", async () => {
    withState("default", { deviceId: "d", logins: 1 })
    withState("work", { deviceId: "e", logins: 2 })

    expect((await look()).loggedInProfiles).toEqual(["default", "work"])
  })

  describe("the token", () => {
    it("says it came from the environment, and never what it is", async () => {
      const report = await look({ env: { MAX_TOKEN: "a-secret" }, storedToken: () => "keyring" })

      expect(report.token).toEqual({ present: true, from: "environment" })
      expect(JSON.stringify(report)).not.toContain("a-secret")
    })

    it("falls back to the keyring, and reports nothing when neither has one", async () => {
      expect((await look({ storedToken: () => "keyring" })).token).toEqual({ present: true, from: "keyring" })
      expect((await look({ storedToken: () => "file" })).token).toEqual({ present: true, from: "file" })
      expect((await look({ storedToken: () => undefined })).token).toEqual({ present: false, from: "none" })
    })
  })

  describe("the keyring entry the environment moves", () => {
    it("**says so when one of the three variables is set** — the failure with no other symptom", async () => {
      const report = await look({ env: { MAX_CONFIG_DIR: "/tmp/elsewhere" } })

      expect(report.keyring.movedByEnvironment).toBe(true)
      expect(report.keyring.service).not.toBe("max-cli")
    })

    it("says the plain service name when nothing moved it", async () => {
      expect((await look()).keyring).toEqual({ service: "max-cli", movedByEnvironment: false })
    })
  })

  describe("the local copy", () => {
    it("**reports a file this build cannot read**, which otherwise looks like a broken search", async () => {
      mkdirSync(at("cache"), { recursive: true })
      writeFileSync(at("cache", "default.db"), "")

      const report = await look({ readSchemaVersion: async () => SCHEMA_VERSION + 1 })
      expect(report.cache).toMatchObject({ exists: true, schemaVersion: SCHEMA_VERSION + 1, readable: false })
    })

    it("calls a file this build speaks readable", async () => {
      mkdirSync(at("cache"), { recursive: true })
      writeFileSync(at("cache", "default.db"), "")

      expect((await look({ readSchemaVersion: async () => SCHEMA_VERSION })).cache.readable).toBe(true)
    })

    it("does not call a missing file unreadable", async () => {
      expect((await look()).cache).toMatchObject({ exists: false, readable: true })
    })
  })
})
