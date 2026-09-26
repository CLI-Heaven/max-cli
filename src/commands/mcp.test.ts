import { describe, expect, it } from "vitest"
import { serverEntry } from "./mcp.js"

const SCRIPT = "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@leemour\\max-cli\\dist\\bin\\max.js"
const entry = (over: Partial<Parameters<typeof serverEntry>[0]> = {}) =>
  serverEntry({
    profile: "default",
    flags: {},
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    scriptPath: SCRIPT,
    env: {},
    ...over,
  })

describe("max mcp config", () => {
  it("starts node and the script by full path, so no .cmd and no PATH are involved", () => {
    expect(entry().config).toEqual({
      mcpServers: {
        max: { type: "stdio", command: "C:\\Program Files\\nodejs\\node.exe", args: [SCRIPT, "mcp"] },
      },
    })
  })

  it("puts the profile first and carries the write flags over", () => {
    const { mcpServers } = entry({ profile: "work", flags: { allowSend: true, confirmSend: true } }).config

    expect(mcpServers).toEqual({
      "max-work": expect.objectContaining({ args: [SCRIPT, "work", "mcp", "--allow-send", "--confirm-send"] }),
    })
  })

  it("copies the directory variables that pick the keyring entry, and never the token", () => {
    const { mcpServers } = entry({ env: { MAX_STATE_DIR: "/s", MAX_TOKEN: "secret", PATH: "/bin" } }).config

    expect(mcpServers.max).toMatchObject({ env: { MAX_STATE_DIR: "/s" } })
    expect(JSON.stringify(mcpServers)).not.toContain("secret")
  })

  it("warns when node belongs to a version manager", () => {
    expect(entry({ execPath: "/home/x/.nvm/versions/node/v24.19.0/bin/node" }).warning).toMatch(/one Node version/)
    expect(entry({ execPath: "/usr/bin/node" }).warning).toBeUndefined()
  })

  it("refuses npx's cache, which is cleared under it", () => {
    const npx = "/home/x/.npm/_npx/1a2b/node_modules/@leemour/max-cli/dist/bin/max.js"

    expect(() => entry({ scriptPath: npx })).toThrow(/npx/)
  })
})
