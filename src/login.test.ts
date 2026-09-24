import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import type { Payload } from "./protocol/frame.js"
import type { BrowserDoors } from "./session/browser.js"
import { SessionStore } from "./session/store.js"
import { type MockMax, mockMax } from "./testing/mock-max.js"

const LOGIN = { profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } } }

/** Answers in turn, the last one repeating — how a poll that is pending and then ready is scripted. */
const inTurn = (...answers: Payload[]) => {
  let at = 0
  return () => answers[Math.min(at++, answers.length - 1)]
}

const qrCode = (overrides: Payload = {}) => ({
  qrLink: "https://qr.example/?token=qr-link-secret",
  trackId: "track-secret",
  pollingInterval: 1,
  expiresAt: Date.now() + 60_000,
  ...overrides,
})

const noBrowser: BrowserDoors = {
  open: async () => {
    throw new Error("no browser was expected")
  },
  chromiumToken: async () => {
    throw new Error("no browser was expected")
  },
}

/**
 * The login happens on one connection and the token is tried on a second, so there are two scripted
 * MAXes: `login` for obtaining the token, `adopt` for the LOGIN that proves it.
 */
const setUp = (login: MockMax | undefined, adopt: MockMax, extra: Partial<Environment> = {}) => {
  const keyring = memoryKeyring()
  const sockets = [login, adopt].filter((max) => max !== undefined)
  let connections = 0
  const streams = captureStreams()
  const environment: Environment = {
    streams,
    tty: false,
    interactive: true,
    // Narrower than any QR code, so the browser path is the default here and nothing depends on
    // the width of whatever terminal runs the suite.
    columns: 20,
    browser: noBrowser,
    ask: async () => {
      throw new Error("nothing was expected to be asked")
    },
    store: (profile) => new SessionStore({ profile, keyring }),
    connection: () => {
      const max = sockets[connections++]
      if (!max) throw new Error("one connection more than was scripted")
      return new Connection({ createSocket: max.createSocket, timeoutMs: 50 })
    },
    ...extra,
  }
  return {
    streams,
    connections: () => connections,
    stored: () => new SessionStore({ profile: "default", keyring }).readToken(),
    start: (...argv: string[]) => run(["session", "start", ...argv], environment),
  }
}

const adopting = () => mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: LOGIN } })

describe("max session start qr", () => {
  it("draws the code here, waits for the phone, and stores the token MAX then accepts", async () => {
    const login = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.GET_QR]: qrCode(),
        [Opcode.GET_QR_STATUS]: inTurn({ status: {} }, { status: { loginAvailable: true } }),
        [Opcode.LOGIN_BY_QR]: { tokenAttrs: { LOGIN: { token: "qr-token" } } },
      },
    })
    const adopt = adopting()
    const { start, stored, streams } = setUp(login, adopt, { columns: 200 })

    expect(await start("qr", "--quiet")).toBe(0)

    expect(streams.stderr.join("\n")).toMatch(/[█▀▄]/)
    expect(streams.stdout.join("")).not.toMatch(/[█▀▄]/)
    expect(login.sent.map(({ opcode }) => opcode)).toEqual([6, 288, 289, 289, 291])
    expect(stored()).toBe("qr-token")
  })

  it("opens the code in the browser when the terminal is too narrow for it", async () => {
    const login = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.GET_QR]: qrCode(),
        [Opcode.GET_QR_STATUS]: inTurn({ status: {} }, { status: { loginAvailable: true } }),
        [Opcode.LOGIN_BY_QR]: { tokenAttrs: { LOGIN: { token: "qr-token" } } },
      },
    })
    const adopt = adopting()
    let page = ""
    const { start, stored, streams } = setUp(login, adopt, {
      browser: {
        ...noBrowser,
        open: async (url) => {
          page = await (await fetch(url)).text()
        },
      },
    })

    expect(await start("qr", "--trace")).toBe(0)

    expect(page).toContain("<svg")
    expect(login.sent.map(({ opcode }) => opcode)).toEqual([6, 288, 289, 289, 291])
    expect(adopt.sent.at(-1)?.payload.token).toBe("qr-token")
    expect(stored()).toBe("qr-token")
    expect(login.closed && adopt.closed).toBe(true)
    expect(JSON.parse(streams.stdout.join(""))).toMatchObject({ stored: true, method: "qr" })

    const everything = [...streams.stdout, ...streams.stderr].join("\n")
    for (const secret of ["qr-token", "track-secret", "qr-link-secret"]) expect(everything).not.toContain(secret)
  })

  it("asks for the cloud password when MAX wants one, and sends it once", async () => {
    const login = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.GET_QR]: qrCode(),
        [Opcode.GET_QR_STATUS]: { status: { loginAvailable: true } },
        [Opcode.LOGIN_BY_QR]: { passwordChallenge: { trackId: "password-track", hint: "the cat" } },
        [Opcode.AUTH_LOGIN_CHECK_PASSWORD]: { tokenAttrs: { LOGIN: { token: "password-token" } } },
      },
    })
    const asked: string[] = []
    const { start, stored } = setUp(login, adopting(), {
      browser: { ...noBrowser, open: async () => {} },
      ask: async (prompt, options) => {
        asked.push(`${prompt}${options?.secret ? " (secret)" : ""}`)
        return "hunter2"
      },
    })

    expect(await start("qr")).toBe(0)

    expect(asked).toEqual(["MAX password (hint: the cat):  (secret)"])
    expect(login.sent.at(-1)?.payload).toEqual({ trackId: "password-track", password: "hunter2" })
    expect(stored()).toBe("password-token")
  })

  it("gives up when the code expires unscanned, and stores nothing", async () => {
    const login = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.GET_QR]: qrCode({ expiresAt: Date.now() + 5, pollingInterval: 20 }),
        [Opcode.GET_QR_STATUS]: { status: {} },
      },
    })
    const { start, stored, connections } = setUp(login, adopting(), {
      browser: { ...noBrowser, open: async () => {} },
    })

    expect(await start("qr")).toBe(9)
    expect(stored()).toBeUndefined()
    expect(connections()).toBe(1)
    expect(login.closed).toBe(true)
  })

  it("stores nothing when MAX refuses the token the login produced", async () => {
    const login = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.GET_QR]: qrCode(),
        [Opcode.GET_QR_STATUS]: { status: { loginAvailable: true } },
        [Opcode.LOGIN_BY_QR]: { tokenAttrs: { LOGIN: { token: "dead-token" } } },
      },
    })
    const adopt = mockMax({ answers: { [Opcode.SESSION_INIT]: {} }, refuse: { [Opcode.LOGIN]: "login.token" } })
    const { start, stored } = setUp(login, adopt, { browser: { ...noBrowser, open: async () => {} } })

    expect(await start("qr")).not.toBe(0)
    expect(stored()).toBeUndefined()
  })
})

describe("max session start qr-chrome and sms", () => {
  it("takes the token the browser logged in with, and still tries it before storing it", async () => {
    const adopt = adopting()
    const { start, stored } = setUp(undefined, adopt, {
      browser: { ...noBrowser, chromiumToken: async () => "chrome-token" },
    })

    expect(await start("qr-chrome")).toBe(0)
    expect(adopt.sent.map(({ opcode }) => opcode)).toEqual([6, 19])
    expect(stored()).toBe("chrome-token")
  })

  it("sends the SMS login to the browser too — over our own socket MAX demands a captcha", async () => {
    let opened = 0
    const { start, stored, streams } = setUp(undefined, adopting(), {
      browser: {
        ...noBrowser,
        chromiumToken: async () => {
          opened++
          return "sms-token"
        },
      },
    })

    expect(await start("sms")).toBe(0)
    expect(opened).toBe(1)
    expect(streams.stderr.join("\n")).toContain("log in by phone number")
    expect(stored()).toBe("sms-token")
  })
})

describe("max session start without a person at the terminal", () => {
  it.each(["qr", "qr-chrome", "sms"])("refuses %s before opening anything", async (method) => {
    const { start, connections } = setUp(undefined, adopting(), { interactive: false })

    expect(await start(method)).toBe(2)
    expect(connections()).toBe(0)
  })

  it("refuses while MAX_TOKEN is set, because it would outrank the new session", async () => {
    const { start, connections } = setUp(undefined, adopting())
    process.env.MAX_TOKEN = "an-exported-token"
    try {
      expect(await start("qr-chrome")).toBe(2)
    } finally {
      delete process.env.MAX_TOKEN
    }
    expect(connections()).toBe(0)
  })

  it("refuses a method it does not know, including the old sms-chrome", async () => {
    const { start } = setUp(undefined, adopting())
    expect(await start("fax")).not.toBe(0)
    expect(await start("sms-chrome")).not.toBe(0)
  })
})
