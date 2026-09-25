import { describe, expect, it } from "vitest"
import { webUserAgent } from "./identity.js"

describe("the web user agent", () => {
  it("presents a Mac in Moscow as the web client on that Mac would", () => {
    expect(webUserAgent({ platform: "darwin", timeZone: "Europe/Moscow", locale: "ru-RU" })).toMatchObject({
      osVersion: "macOS",
      locale: "ru",
      deviceLocale: "ru",
      timezone: "Europe/Moscow",
      screen: "900x1440 2.0x",
      headerUserAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    })
  })

  it("matches the Linux Chrome captured from web.max.ru on 2026-09-25", () => {
    expect(webUserAgent({ platform: "linux", timeZone: "Europe/Madrid", locale: "en-US" })).toMatchObject({
      osVersion: "Linux",
      locale: "en",
      deviceLocale: "en",
      headerUserAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    })
  })

  it("keeps a language the app does not offer as the device's, and speaks Russian itself", () => {
    const agent = webUserAgent({ platform: "win32", timeZone: "Asia/Almaty", locale: "kk-KZ" })
    expect(agent).toMatchObject({ osVersion: "Windows", locale: "ru", deviceLocale: "kk" })
    expect(agent.headerUserAgent).toContain("Windows NT 10.0; Win64; x64")
  })

  it("falls back to Moscow and Russian when the system says nothing", () => {
    expect(webUserAgent({ platform: "freebsd", timeZone: undefined, locale: undefined })).toMatchObject({
      osVersion: "Linux",
      locale: "ru",
      timezone: "Europe/Moscow",
    })
  })
})
