/**
 * What we claim to be on the wire.
 *
 * **We imitate MAX's own web client rather than announcing ourselves** (`REQUIREMENTS.md` §34), so
 * none of these values names this tool. Shape and field names from `max-api-docs/protocol/auth.md`,
 * cross-checked against tsmax's `createWebAgent`.
 *
 * The device identity is deliberately not here: it is generated once per profile and stored,
 * because a client presenting a new device on every command is not imitating anything.
 */
export const WEB_USER_AGENT = {
  deviceType: "WEB",
  pushDeviceType: "WEBPUSH",
  locale: "ru",
  deviceLocale: "ru",
  osVersion: "Linux",
  deviceName: "Chrome",
  headerUserAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  appVersion: "26.5.5",
  screen: "1080x1920 1.0x",
  timezone: "Europe/Madrid",
} as const
