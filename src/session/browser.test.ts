import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ChromiumSession, serveQrPage, tokenIn } from "./browser.js"

describe("tokenIn", () => {
  it("reads the token out of a stored object, or takes a bare string as it is", () => {
    expect(tokenIn(JSON.stringify({ token: "from-an-object", viewerId: 1 }))).toBe("from-an-object")
    expect(tokenIn(JSON.stringify("a-json-string"))).toBe("a-json-string")
    expect(tokenIn("a-bare-token")).toBe("a-bare-token")
  })

  it("finds nothing in an empty value or an object without a token", () => {
    expect(tokenIn("")).toBeUndefined()
    expect(tokenIn(JSON.stringify({ viewerId: 1 }))).toBeUndefined()
    expect(tokenIn(JSON.stringify({ token: "" }))).toBeUndefined()
  })
})

describe("ChromiumSession.close", () => {
  it("**removes the logged-in profile** even when the browser has to be killed", async () => {
    const profile = mkdtempSync(join(tmpdir(), "max-login-"))
    writeFileSync(join(profile, "Local Storage"), "a session")
    const browser = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" })
    const session = new ChromiumSession(browser, profile, 9, 50)

    await Promise.all([session.close(), session.close()])

    expect(existsSync(profile)).toBe(false)
    expect(browser.exitCode !== null || browser.signalCode !== null).toBe(true)
  })
})

describe("serveQrPage", () => {
  it("serves the code at a random path only, and stops when closed", async () => {
    const page = await serveQrPage("https://qr.example/?token=x")
    const origin = new URL(page.url).origin

    expect(await (await fetch(page.url)).text()).toContain("<svg")
    expect((await fetch(`${origin}/`)).status).toBe(404)

    await page.close()
    await expect(fetch(page.url)).rejects.toThrow()
  })
})
