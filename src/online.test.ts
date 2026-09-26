import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { MaxClient } from "./client.js"
import { checkOnline, mcpHandshake } from "./online.js"

const client = (login: () => Promise<unknown>) => {
  const calls: string[] = []
  const fake = {
    account: {
      me: async () => {
        calls.push("me")
        return login()
      },
    },
    chats: {
      list: async () => {
        calls.push("chats")
        return { items: [{}] }
      },
    },
    close: async () => void calls.push("close"),
  }
  return { client: fake as unknown as MaxClient, calls }
}

describe("max doctor --online", () => {
  it("logs in, reads one chat, closes, then asks the MCP server for its tools", async () => {
    const { client: max, calls } = client(async () => ({}))

    expect(await checkOnline(max, async () => 12)).toEqual([
      { name: "login", ok: true, detail: "logged in" },
      { name: "chats", ok: true, detail: "1 read" },
      { name: "mcp", ok: true, detail: "12 tools offered" },
    ])
    expect(calls).toEqual(["me", "chats", "close"])
  })

  it("does not read after a failed login, and never tries the login again", async () => {
    const { client: max, calls } = client(async () => {
      throw new Error("no session")
    })

    const checks = await checkOnline(max, async () => 12)

    expect(checks.map(({ name, ok }) => [name, ok])).toEqual([
      ["login", false],
      ["mcp", true],
    ])
    expect(calls).toEqual(["me", "close"])
  })

  it("speaks MCP to a child process: initialize, then tools/list, then closes its stdin", async () => {
    const script = join(mkdtempSync(join(tmpdir(), "max-mcp-")), "server.mjs")
    writeFileSync(
      script,
      `import { createInterface } from "node:readline"
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line)
  if (method === "initialize") reply(id, { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "t", version: "0" } })
  if (method === "tools/list") reply(id, { tools: [{ name: "a" }, { name: "b" }] })
})`,
    )

    expect(await mcpHandshake({ execPath: process.execPath, scriptPath: script, env: {} })).toBe(2)
  })
})
