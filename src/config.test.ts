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

describe("--timeout", () => {
  it("reads a duration in the three units it accepts", () => {
    expect(settings({ timeout: "500ms" }).commandTimeoutMs).toBe(500)
    expect(settings({ timeout: "30s" }).commandTimeoutMs).toBe(30_000)
    expect(settings({ timeout: "2m" }).commandTimeoutMs).toBe(120_000)
  })

  it("**refuses a bare number**, because the unit is the whole question", () => {
    // `timeoutMs` in the configuration file is milliseconds and every comparable tool means
    // seconds. Either guess is a thirty-fold surprise, so it asks.
    expect(() => settings({ timeout: "30" })).toThrow(/30s, 2m or 500ms/)
    expect(() => settings({ timeout: "abc" })).toThrow(/duration with a unit/)
  })

  it("refuses a duration of nothing, which would end the command before it began", () => {
    expect(() => settings({ timeout: "0s" })).toThrow(/more than zero/)
  })

  it("has no bound unless one is given", () => {
    expect(settings().commandTimeoutMs).toBeUndefined()
  })

  it("reads `MAX_TIMEOUT`, and the flag outranks it", () => {
    expect(settings({}, { MAX_TIMEOUT: "10s" }).commandTimeoutMs).toBe(10_000)
    expect(settings({ timeout: "1s" }, { MAX_TIMEOUT: "10s" }).commandTimeoutMs).toBe(1000)
  })

  it("names the variable, not the flag, when the variable is the broken one", () => {
    // Somebody who set this in a shell profile weeks ago needs to know which thing is wrong.
    expect(() => settings({}, { MAX_TIMEOUT: "soon" })).toThrow(/MAX_TIMEOUT/)
    expect(() => settings({ timeout: "soon" })).toThrow(/--timeout/)
  })

  it("**is not `timeoutMs`**, which stays one request's wait and comes only from the file", () => {
    withConfig(JSON.stringify({ profiles: { default: { timeoutMs: 5000 } } }))
    const resolved = settings({ timeout: "30s" })

    expect(resolved.timeoutMs).toBe(5000)
    expect(resolved.commandTimeoutMs).toBe(30_000)
  })
})

describe("paging", () => {
  it("starts at page one, and turns a page into an offset nobody re-derives", () => {
    expect(settings().page).toBe(1)
    expect(settings({ page: 3 }).page).toBe(3)
    expect(settings().all).toBe(false)
  })

  it("**refuses `--all` with `--page`** rather than letting one of them quietly win", () => {
    expect(() => settings({ all: true, page: 2 })).toThrow(/--all and --page/)
  })

  it("takes `--all` on its own", () => {
    expect(settings({ all: true }).all).toBe(true)
  })

  it("refuses a page number that is not one", () => {
    expect(() => settings({ page: 0 })).toThrow(/--page/)
    expect(() => settings({ page: Number.NaN })).toThrow(/--page/)
  })

  it("**has no configuration field for either**, because a page number in a file is a setting nobody wants twice", () => {
    withConfig(JSON.stringify({ profiles: { default: { page: 2 } } }))
    expect(() => settings()).toThrow()
  })
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
