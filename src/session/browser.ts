import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import type { Readable, Writable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import { CliError } from "@leemour/cli-core"
import qrcode from "qrcode-generator"
import type { Closeable } from "../deadline.js"

/**
 * What `session start` needs from a browser. Injected in tests, which must never open a window on
 * the owner's desktop — the real ones refuse inside the test sandbox.
 */
export interface BrowserDoors {
  /** Shows a page in whatever browser the system opens links with. */
  open: (url: string) => Promise<void>
  /** Opens web.max.ru in a Chromium-family browser and waits for the page to be logged in. */
  chromiumToken: (options: { track: (closeable: Closeable) => void; waitMs: number }) => Promise<string>
}

export const realBrowser: BrowserDoors = {
  open: (url) => openUrl(url),
  chromiumToken: (options) => tokenFromChromium(options),
}

const WEB_MAX = "https://web.max.ru/"
const AUTH_KEY = "__oneme_auth"

/**
 * The QR page, served from `127.0.0.1` rather than written to a file: a browser installed as a
 * snap cannot read our temporary directory, and a file would leave the link on disk. The path is
 * random, so another local user guessing the port finds nothing.
 */
export const serveQrPage = async (link: string): Promise<{ url: string } & Closeable> => {
  const path = `/${randomBytes(16).toString("hex")}`
  const code = qrcode(0, "M")
  code.addData(link)
  code.make()
  const page = qrHtml(code.createSvgTag({ cellSize: 8, margin: 4, scalable: true }))

  const server = createServer((request, response) => {
    if (request.url !== path) {
      response.writeHead(404).end()
      return
    }
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      })
      .end(page)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

const qrHtml = (svg: string): string => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>MAX — вход</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fff;color:#111}
main{text-align:center;max-width:22rem}svg{width:18rem;height:18rem}</style></head>
<body><main>${svg}<p>Отсканируйте код приложением MAX на телефоне. Код действует около двух минут.</p>
<p>После входа эту вкладку можно закрыть.</p></main></body></html>`

export const openUrl = async (url: string): Promise<void> => {
  refuseInTests()
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true })
    child.once("error", () =>
      reject(new CliError("configuration_error", "no browser could be opened here — use `session start token`")),
    )
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

/**
 * Chrome, Chromium, Edge or Brave — any browser that speaks the DevTools protocol. `MAX_BROWSER`
 * names another. A snap build is skipped: it keeps its own `/tmp`, so the profile we hand it would
 * land where we cannot delete it.
 */
export const findChromium = (): string | undefined => {
  const named = process.env.MAX_BROWSER
  if (named) return named

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ].find((path) => existsSync(path))
  }

  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
    const apps = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ]
    return apps
      .flatMap((app) => roots.filter((root) => root !== undefined).map((root) => join(root, app)))
      .find(existsSync)
  }

  const names = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
  ]
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) {
      const path = join(dir, name)
      if (existsSync(path) && !realpathSync(path).startsWith("/snap/")) return path
    }
  }
  return undefined
}

/**
 * web.max.ru logs itself in — it asks MAX for the QR code, or sends the SMS — in a real browser with
 * a profile of its own, and we read the token it stores once it has one. MAX sees its own web
 * client do the login, not our socket.
 *
 * ⚠ The profile holds a live session, so it is deleted on every way out: success, a closed window,
 * `--timeout`, Ctrl-C.
 */
export const tokenFromChromium = async ({
  track,
  waitMs,
}: {
  track: (closeable: Closeable) => void
  waitMs: number
}): Promise<string> => {
  refuseInTests()
  const binary = findChromium()
  if (!binary) {
    throw new CliError(
      "configuration_error",
      "no Chrome, Chromium, Edge or Brave found — set MAX_BROWSER to one, or use `session start qr`",
    )
  }

  const profile = mkdtempSync(join(tmpdir(), "max-login-"))
  // A pipe, not `--remote-debugging-port`: a port on 127.0.0.1 lets any local user read the token
  // while the window is open. Chrome reads commands on fd 3 and answers on fd 4.
  const child = spawn(
    binary,
    [`--user-data-dir=${profile}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", WEB_MAX],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  )
  const browser = new ChromiumSession(child, profile)
  track(browser)

  const stopSignals = closeOnSignal(browser)
  try {
    return await browser.waitForToken(waitMs)
  } finally {
    stopSignals()
    await browser.close()
  }
}

export class ChromiumSession implements Closeable {
  readonly #child: ChildProcess
  readonly #profile: string
  readonly #devtools: DevToolsPipe
  readonly #exited: Promise<void>
  readonly #graceMs: number
  #page: { targetId: string; sessionId: string } | undefined
  #closing: Promise<void> | undefined

  constructor(child: ChildProcess, profile: string, graceMs = 5_000) {
    this.#child = child
    this.#profile = profile
    this.#graceMs = graceMs
    this.#devtools = new DevToolsPipe(child)
    this.#exited = new Promise((resolve) => {
      child.once("exit", () => resolve())
      child.once("error", () => resolve())
    })
  }

  async waitForToken(waitMs: number): Promise<string> {
    const deadline = Date.now() + waitMs
    let running = true
    void this.#exited.then(() => {
      running = false
    })

    while (Date.now() < deadline) {
      if (!running) throw new CliError("cancelled", "the browser was closed before the login finished")
      const token = await this.#storedToken().catch(() => undefined)
      if (token) return token
      await delay(1_000)
    }
    throw new CliError("timeout", `nobody logged in within ${Math.round(waitMs / 60_000)} minutes`)
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutdown()
    return this.#closing
  }

  async #shutdown(): Promise<void> {
    // Chrome writes to the profile while it shuts down; removing it first leaves half of it behind.
    await this.#devtools.send("Browser.close").catch(() => undefined)

    const exited = await Promise.race([this.#exited.then(() => true), delay(this.#graceMs).then(() => false)])
    if (!exited && this.#child.pid !== undefined) {
      this.#child.kill()
      await Promise.race([this.#exited, delay(2_000)])
    }
    rmSync(this.#profile, { recursive: true, force: true, maxRetries: 3 })
  }

  async #storedToken(): Promise<string | undefined> {
    const { targetInfos } = await this.#devtools.send("Target.getTargets")
    const page = (Array.isArray(targetInfos) ? targetInfos : []).find(
      (target) => target?.type === "page" && typeof target.url === "string" && target.url.startsWith(WEB_MAX),
    )
    if (typeof page?.targetId !== "string") return undefined

    if (this.#page?.targetId !== page.targetId) {
      const { sessionId } = await this.#devtools.send("Target.attachToTarget", {
        targetId: page.targetId,
        flatten: true,
      })
      this.#page = { targetId: page.targetId, sessionId }
    }
    const sessionId = this.#page?.sessionId
    if (typeof sessionId !== "string") return undefined

    const result = await this.#devtools.send(
      "Runtime.evaluate",
      { expression: `localStorage.getItem(${JSON.stringify(AUTH_KEY)})`, returnByValue: true },
      sessionId,
    )
    const stored = result?.result?.value
    return typeof stored === "string" ? tokenIn(stored) : undefined
  }
}

/** The DevTools protocol over Chrome's pipe: JSON messages, each ended by a NUL byte. */
class DevToolsPipe {
  readonly #input: Writable | undefined
  readonly #waiting = new Map<
    number,
    // biome-ignore lint/suspicious/noExplicitAny: the DevTools answers are read defensively, field by field.
    { resolve: (result: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  #next = 0
  #buffer = ""

  constructor(child: ChildProcess) {
    this.#input = child.stdio[3] as Writable | undefined
    const output = child.stdio[4] as Readable | undefined
    // A pipe that breaks with no listener kills the process (HANDOFF bite 16).
    this.#input?.on("error", () => {})
    output?.on("error", () => {})
    output?.setEncoding("utf8")
    output?.on("data", (chunk: string) => {
      this.#buffer += chunk
      for (let end = this.#buffer.indexOf("\0"); end >= 0; end = this.#buffer.indexOf("\0")) {
        this.#receive(this.#buffer.slice(0, end))
        this.#buffer = this.#buffer.slice(end + 1)
      }
    })
    child.once("exit", () => this.#failAll(new Error("the browser exited")))
  }

  // biome-ignore lint/suspicious/noExplicitAny: see above.
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const input = this.#input
    if (!input || input.destroyed) return Promise.reject(new Error("the browser has no DevTools pipe"))

    const id = ++this.#next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id)
        reject(new Error("the browser did not answer"))
      }, 5_000)
      this.#waiting.set(id, { resolve, reject, timer })
      input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`)
    })
  }

  #receive(raw: string): void {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } }
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    const waiting = typeof message.id === "number" ? this.#waiting.get(message.id) : undefined
    if (!waiting) return

    clearTimeout(waiting.timer)
    this.#waiting.delete(message.id as number)
    if (message.error) waiting.reject(new Error(String(message.error.message ?? "DevTools refused")))
    else waiting.resolve(message.result ?? {})
  }

  #failAll(error: Error): void {
    for (const { reject, timer } of this.#waiting.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.#waiting.clear()
  }
}

/**
 * The stored value is JSON holding the token, or the token itself — which one is not measured yet.
 * Either way nothing here prints it.
 */
export const tokenIn = (stored: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed === "object" && parsed !== null && "token" in parsed) {
      const token = (parsed as { token: unknown }).token
      return typeof token === "string" && token !== "" ? token : undefined
    }
    return typeof parsed === "string" && parsed !== "" ? parsed : undefined
  } catch {
    return stored === "" ? undefined : stored
  }
}

/**
 * Node's default Ctrl-C exits without running a `finally`, which would leave the browser open and
 * its logged-in profile on disk. Returns the function that removes the handlers again.
 */
const closeOnSignal = (closeable: Closeable): (() => void) => {
  const onSignal = () => {
    void closeable.close().finally(() => process.exit(130))
  }
  // `on`, not `once`: a second Ctrl-C during the shutdown would otherwise exit before the profile goes.
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)
  return () => {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
  }
}

const refuseInTests = (): void => {
  if (process.env.MAX_TEST_SANDBOX) throw new Error("a test reached the real browser — inject BrowserDoors")
}
