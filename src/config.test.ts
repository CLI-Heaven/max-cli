import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { resolveSettings } from "./config.js"

let configDir: string

const withConfig = (contents: string): void => {
  writeFileSync(join(configDir, "config.json"), contents)
}

const settings = (flags = {}, env: NodeJS.ProcessEnv = {}) => resolveSettings(flags, { env, configDir })

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "max-config-"))
})

describe("the order a setting is decided in", () => {
  it("prefers the command line to everything else", () => {
    withConfig(JSON.stringify({ defaultProfile: "fromFile" }))
    expect(settings({ profile: "fromFlag" }, { MAX_PROFILE: "fromEnv" }).profile).toBe("fromFlag")
  })

  it("prefers the environment to the file", () => {
    withConfig(JSON.stringify({ defaultProfile: "fromFile" }))
    expect(settings({}, { MAX_PROFILE: "fromEnv" }).profile).toBe("fromEnv")
  })

  it("prefers the file to the built-in default", () => {
    withConfig(JSON.stringify({ defaultProfile: "fromFile" }))
    expect(settings().profile).toBe("fromFile")
  })

  it("falls back to `default`, which is what an unconfigured machine has", () => {
    expect(settings().profile).toBe("default")
  })

  it("reads `MAX_PROFILE` as unset when the shell set it to nothing", () => {
    expect(settings({}, { MAX_PROFILE: "  " }).profile).toBe("default")
  })

  it("carries the same three steps for a number", () => {
    withConfig(JSON.stringify({ profiles: { default: { limit: 5 } } }))
    expect(settings({ limit: 3 }).limit).toBe(3)
    expect(settings().limit).toBe(5)

    withConfig(JSON.stringify({ profiles: {} }))
    expect(settings().limit).toBe(20)
  })

  it("takes the settings of the profile in play, not of the first one in the file", () => {
    withConfig(JSON.stringify({ profiles: { default: { limit: 1 }, personal: { limit: 99, color: false } } }))
    expect(settings({ profile: "personal" })).toMatchObject({ limit: 99, color: false })
  })

  it("leaves a profile the file says nothing about on the defaults", () => {
    withConfig(JSON.stringify({ profiles: { personal: { limit: 99 } } }))
    expect(settings({ profile: "other" })).toMatchObject({ limit: 20, timeoutMs: undefined, color: undefined })
  })
})

describe("the configuration file", () => {
  it("**is not required** — an unconfigured machine is not a broken one", () => {
    expect(settings().profile).toBe("default")
  })

  it("**names the field when one is misspelled**, rather than silently using the default", () => {
    withConfig(JSON.stringify({ profiles: { default: { limitt: 5 } } }))
    expect(() => settings()).toThrowError(/profiles\.default\.limitt/)
    expect(() => settings()).toThrowError(expect.objectContaining({ code: "configuration_error" }))
  })

  it("names a misspelled top-level field too", () => {
    withConfig(JSON.stringify({ defaultProfil: "personal" }))
    expect(() => settings()).toThrowError(/defaultProfil/)
  })

  it("**has nowhere to put a secret**, so a config carrying one is refused", () => {
    withConfig(JSON.stringify({ profiles: { default: { token: "whatever-this-is" } } }))
    expect(() => settings()).toThrowError(/token/)
  })

  it("refuses a setting of the wrong type, naming it", () => {
    withConfig(JSON.stringify({ profiles: { default: { limit: "20" } } }))
    expect(() => settings()).toThrowError(/profiles\.default\.limit/)
  })

  it("says the file is not JSON rather than reporting a missing setting", () => {
    withConfig("{ this is not json }")
    expect(() => settings()).toThrowError(/not valid JSON/)
  })
})

describe("what a flag is checked for", () => {
  it("refuses `--limit` that is not a whole number, instead of quietly showing nothing", () => {
    expect(() => settings({ limit: Number.NaN })).toThrowError(expect.objectContaining({ code: "validation_error" }))
    expect(() => settings({ limit: 0 })).toThrowError(/whole number/)
  })

  it("refuses a profile name that would become a path", () => {
    expect(() => settings({ profile: "../elsewhere" })).toThrowError(
      expect.objectContaining({ code: "validation_error" }),
    )
  })
})
