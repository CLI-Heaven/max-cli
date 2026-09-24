import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { type AddressInfo, createServer as createTcpServer } from "node:net"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { CliError } from "@leemour/cli-core"
import qrcode from "qrcode-generator"
import { WebSocket } from "ws"
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
  const port = await freePort()
  const child = spawn(
    binary,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      WEB_MAX,
    ],
    { stdio: "ignore" },
  )
  const browser = new ChromiumSession(child, profile, port)
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
  readonly #port: number
  readonly #exited: Promise<void>
  readonly #graceMs: number
  #closing: Promise<void> | undefined

  constructor(child: ChildProcess, profile: string, port: number, graceMs = 5_000) {
    this.#child = child
    this.#graceMs = graceMs
    this.#profile = profile
    this.#port = port
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
    const version = await this.#json("/json/version").catch(() => undefined)
    const endpoint = typeof version?.webSocketDebuggerUrl === "string" ? version.webSocketDebuggerUrl : undefined
    if (endpoint) await evaluateOver(endpoint, "Browser.close", {}).catch(() => undefined)

    const exited = await Promise.race([this.#exited.then(() => true), delay(this.#graceMs).then(() => false)])
    if (!exited && this.#child.pid !== undefined) {
      this.#child.kill()
      await Promise.race([this.#exited, delay(2_000)])
    }
    rmSync(this.#profile, { recursive: true, force: true, maxRetries: 3 })
  }

  async #storedToken(): Promise<string | undefined> {
    const targets = await this.#json("/json/list")
    const page = (Array.isArray(targets) ? targets : []).find(
      (target) => target?.type === "page" && typeof target.url === "string" && target.url.startsWith(WEB_MAX),
    )
    if (typeof page?.webSocketDebuggerUrl !== "string") return undefined

    const result = await evaluateOver(page.webSocketDebuggerUrl, "Runtime.evaluate", {
      expression: `localStorage.getItem(${JSON.stringify(AUTH_KEY)})`,
      returnByValue: true,
    })
    const stored = result?.result?.value
    return typeof stored === "string" ? tokenIn(stored) : undefined
  }

  // biome-ignore lint/suspicious/noExplicitAny: the DevTools answers are read defensively, field by field.
  async #json(path: string): Promise<any> {
    const response = await fetch(`http://127.0.0.1:${this.#port}${path}`, { signal: AbortSignal.timeout(2_000) })
    return await response.json()
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

// biome-ignore lint/suspicious/noExplicitAny: see #json.
const evaluateOver = (endpoint: string, method: string, params: object): Promise<any> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint)
    const timer = setTimeout(() => {
      socket.terminate()
      reject(new Error("the browser did not answer"))
    }, 5_000)
    socket.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.once("open", () => socket.send(JSON.stringify({ id: 1, method, params })))
    socket.on("message", (data) => {
      const message = JSON.parse(String(data))
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      resolve(message.result)
    })
  })

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

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createTcpServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })

const refuseInTests = (): void => {
  if (process.env.MAX_TEST_SANDBOX) throw new Error("a test reached the real browser — inject BrowserDoors")
}
