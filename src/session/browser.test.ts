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
    const session = new ChromiumSession(browser, profile, 50)

    await Promise.all([session.close(), session.close()])

    expect(existsSync(profile)).toBe(false)
    expect(browser.exitCode !== null || browser.signalCode !== null).toBe(true)
  })
})

/**
 * A stand-in for Chrome on the DevTools pipe: commands on fd 3, answers on fd 4, NUL after each.
 * It shows web.max.ru logged out on the first read and logged in on the second.
 */
const FAKE_CHROME = `
const fs = require("node:fs")
const input = fs.createReadStream(null, { fd: 3, encoding: "utf8" })
const output = fs.createWriteStream(null, { fd: 4 })
let reads = 0
let buffer = ""
const answer = (id, result) => output.write(JSON.stringify({ id, result }) + "\\0")
input.on("data", (chunk) => {
  buffer += chunk
  for (let end = buffer.indexOf("\\0"); end >= 0; end = buffer.indexOf("\\0")) {
    const { id, method, sessionId } = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (method === "Target.getTargets")
      answer(id, { targetInfos: [{ type: "page", targetId: "T1", url: "https://web.max.ru/" }] })
    else if (method === "Target.attachToTarget") answer(id, { sessionId: "S1" })
    else if (method === "Runtime.evaluate")
      answer(id, { result: { value: sessionId === "S1" && ++reads > 1 ? JSON.stringify({ token: "piped-token" }) : null } })
    else if (method === "Browser.close") process.exit(0)
  }
})
`

describe("ChromiumSession over the DevTools pipe", () => {
  it("waits until web.max.ru is logged in, reads its token, and closes the browser", async () => {
    const profile = mkdtempSync(join(tmpdir(), "max-login-"))
    const browser = spawn(process.execPath, ["-e", FAKE_CHROME], {
      stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"],
    })
    const session = new ChromiumSession(browser, profile, 2_000)

    expect(await session.waitForToken(10_000)).toBe("piped-token")
    await session.close()

    expect(browser.exitCode).toBe(0)
    expect(existsSync(profile)).toBe(false)
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
