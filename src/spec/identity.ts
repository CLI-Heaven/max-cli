/**
 * What we claim to be on the wire.
 *
 * **We imitate MAX's own web client rather than announcing ourselves** (`REQUIREMENTS.md` §34), so
 * none of these values names this tool. Fields, their order and the versions are what web.max.ru
 * sent on 2026-09-25 (`src/testing/fixtures/web-capture-2026-09-25.json`, the INIT frame).
 *
 * **Built from this machine, as the web client builds it from the browser** (`MAX-55`): timezone
 * from `Intl`, the language from the system, the OS and the matching Chrome user agent from the
 * platform. A fixed value would give every install of a public package the same Madrid-and-Linux
 * browser. How web.max.ru fills each field: `docs/dev/capture/2026-09-25-web-tab.md`.
 *
 * The device identity is deliberately not here: it is generated once per profile and stored,
 * because a client presenting a new device on every command is not imitating anything.
 */

const CHROME = "Chrome/151.0.0.0"
const APP_VERSION = "26.9.8"

/**
 * When `APP_VERSION` and `CHROME` were read from a live tab. MAX refuses a client version it has
 * dropped (PyMax #86), so `max doctor` reports their age (`MAX-39`); a release updates all three.
 */
export const CLIENT = { appVersion: APP_VERSION, chrome: CHROME, readOn: "2026-09-25" } as const

/** Chrome's reduced user agent keeps one frozen OS string per platform. */
const PLATFORMS = {
  linux: { osVersion: "Linux", system: "X11; Linux x86_64", screen: "1080x1920 1.0x" },
  darwin: { osVersion: "macOS", system: "Macintosh; Intel Mac OS X 10_15_7", screen: "900x1440 2.0x" },
  win32: { osVersion: "Windows", system: "Windows NT 10.0; Win64; x64", screen: "1080x1920 1.0x" },
} as const

/** The languages the MAX interface itself offers; anything else falls back to Russian, as the app does. */
const APP_LANGUAGES = new Set(["ru", "en"])

export interface Host {
  platform: string
  timeZone: string | undefined
  locale: string | undefined
}

export const thisHost = (): Host => {
  const options = Intl.DateTimeFormat().resolvedOptions()
  return { platform: process.platform, timeZone: options.timeZone, locale: options.locale }
}

export const webUserAgent = ({ platform, timeZone, locale }: Host) => {
  const host = PLATFORMS[platform as keyof typeof PLATFORMS] ?? PLATFORMS.linux
  const language = locale?.slice(0, 2).toLowerCase() || "ru"
  return {
    deviceType: "WEB",
    pushDeviceType: "WEBPUSH",
    locale: APP_LANGUAGES.has(language) ? language : "ru",
    deviceLocale: language,
    osVersion: host.osVersion,
    deviceName: "Chrome",
    headerUserAgent: `Mozilla/5.0 (${host.system}) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME} Safari/537.36`,
    isPwa: false,
    appVersion: APP_VERSION,
    screen: host.screen,
    timezone: timeZone || "Europe/Moscow",
  } as const
}

export const WEB_USER_AGENT = webUserAgent(thisHost())
