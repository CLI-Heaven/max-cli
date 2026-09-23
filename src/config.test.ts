import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { changeSetting, configuredProfiles, resolveSettings } from "./config.js"

let configDir: string

const withConfig = (contents: string): void => {
  writeFileSync(join(configDir, "config.json"), contents)
}

const settings = (flags = {}, env: NodeJS.ProcessEnv = {}) => resolveSettings(flags, { env, configDir })

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "max-config-"))
})

describe("where a setting came from", () => {
  it("names the layer that decided the profile, so nobody has to re-derive the order", () => {
    expect(settings().sources.profile).toBe("default")
    expect(settings({}, { MAX_PROFILE: "work" }).sources.profile).toBe("MAX_PROFILE")
    expect(settings({ profile: "work" }, { MAX_PROFILE: "other" }).sources.profile).toBe("first word")
  })

  it("credits the file when the file is what decided it", () => {
    withConfig(JSON.stringify({ defaultProfile: "work" }))
    expect(settings().profile).toBe("work")
    expect(settings().sources.profile).toBe("config file")
  })

  it("**names where the command budget came from**, which has no file row to fall back on", () => {
    expect(settings().sources.commandTimeoutMs).toBe("default")
    expect(settings({}, { MAX_TIMEOUT: "10s" }).sources.commandTimeoutMs).toBe("MAX_TIMEOUT")
    expect(settings({ timeout: "1s" }).sources.commandTimeoutMs).toBe("flag")
  })
})

describe("the profiles a file lists", () => {
  it("**is not every profile that works**, and the command that prints it has to say so", () => {
    withConfig(JSON.stringify({ profiles: { default: { limit: 5 }, work: {} } }))
    expect(configuredProfiles({ env: {}, configDir })).toEqual(["default", "work"])

    // `max <name> session start` stores a token under any name and writes nothing to the file, so
    // this list under-reports by design. `max config show` says as much on every run.
    expect(configuredProfiles({ env: {}, configDir })).not.toContain("personal")
  })

  it("is empty, not an error, when there is no file", () => {
    expect(configuredProfiles({ env: {}, configDir })).toEqual([])
  })
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

  it("**says in plain words what is wrong and what is allowed**, not the validation library's", () => {
    withConfig(JSON.stringify({ profiles: { default: { limitt: 5 } } }))
    expect(() => settings()).toThrowError(
      "profiles.default.limitt: unknown setting — the known ones are limit, timeoutMs, color, senderColors, record, " +
        "keepRunsForDays",
    )

    withConfig(JSON.stringify({ profiles: { default: { limit: 0, color: "yes" } } }))
    expect(() => settings()).toThrowError("profiles.default.limit: has to be a whole number, 1 or more, not 0")
    expect(() => settings()).toThrowError('profiles.default.color: has to be true or false, not "yes"')

    withConfig(JSON.stringify({ profiles: { default: { limit: 2.5 } }, defaultProfil: "x" }))
    expect(() => settings()).toThrowError("limit: has to be a whole number, 1 or more, not 2.5")
    expect(() => settings()).toThrowError(
      "defaultProfil: unknown setting — the known ones are defaultProfile, profiles",
    )
    expect(() => settings()).not.toThrowError(/Expected|Invalid/)
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

describe("where each setting came from", () => {
  it("says default for everything when nothing is configured, and that no file was found", () => {
    const resolved = settings()
    expect(resolved.configFound).toBe(false)
    expect(Object.values(resolved.sources).every((from) => from === "default")).toBe(true)
  })

  it("tells a flag from the file from the built-in value", () => {
    withConfig(JSON.stringify({ profiles: { default: { limit: 7, record: true } } }))

    expect(settings().sources).toMatchObject({ limit: "config file", record: "config file", color: "default" })
    expect(settings({ limit: 3 }).sources.limit).toBe("flag")
    expect(settings({ limit: 3 }).limit).toBe(3)
    expect(settings().configFound).toBe(true)
  })

  it("names what chose the profile: the first word, then MAX_PROFILE, then the file", () => {
    withConfig(JSON.stringify({ defaultProfile: "home", profiles: { home: {}, work: {} } }))

    expect(settings({ profile: "work" }, { MAX_PROFILE: "home" }).sources.profile).toBe("first word")
    expect(settings({}, { MAX_PROFILE: "work" }).sources.profile).toBe("MAX_PROFILE")
    expect(settings().sources.profile).toBe("config file")
    expect(settings().configuredProfiles).toEqual(["home", "work"])
  })
})

describe("defaults shared by every profile", () => {
  it("sit between the profile's own setting and the built-in one", () => {
    withConfig(JSON.stringify({ defaults: { limit: 50, record: true }, profiles: { work: { limit: 5 } } }))

    expect(settings({ profile: "work" })).toMatchObject({ limit: 5, record: true })
    expect(settings({ profile: "work" }).sources).toMatchObject({ limit: "config file", record: "config defaults" })
    expect(settings({ limit: 7 }).limit).toBe(7)
    expect(settings().sources.limit).toBe("config defaults")
  })
})

describe("changing a setting", () => {
  const path = () => join(configDir, "config.json")
  const file = () => JSON.parse(readFileSync(path(), "utf8"))

  it("writes a profile's setting as the type the file holds, and removes it again", () => {
    expect(changeSetting(path(), { profile: "work", setting: "limit", value: "50" })).toBe(50)
    changeSetting(path(), { profile: "work", setting: "record", value: "true" })
    expect(file()).toEqual({ profiles: { work: { limit: 50, record: true } } })

    changeSetting(path(), { profile: "work", setting: "limit", value: undefined })
    changeSetting(path(), { profile: "work", setting: "record", value: undefined })
    expect(file()).toEqual({ profiles: {} })
  })

  it("writes to `defaults` when no profile is named", () => {
    changeSetting(path(), { profile: undefined, setting: "keepRunsForDays", value: "7" })
    expect(file().defaults).toEqual({ keepRunsForDays: 7 })
  })

  it("**refuses a value the reader would refuse, and leaves the file as it was**", () => {
    withConfig(JSON.stringify({ profiles: { work: { limit: 5 } } }))

    expect(() => changeSetting(path(), { profile: "work", setting: "limit", value: "0" })).toThrow(/limit/)
    expect(() => changeSetting(path(), { profile: "work", setting: "color", value: "blue" })).toThrow(/color/)
    expect(() => changeSetting(path(), { profile: "work", setting: "limitt", value: "5" })).toThrow(/no setting/)
    expect(file()).toEqual({ profiles: { work: { limit: 5 } } })
  })
})
