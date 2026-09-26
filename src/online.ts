import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { MaxClient } from "./client.js"
import { VERSION } from "./version.js"

export interface Check {
  name: string
  ok: boolean
  detail: string
}

const HANDSHAKE_MS = 20_000

/**
 * `max doctor --online`: **one login and two reads**, then the MCP server started the way a client
 * starts it. Nothing is sent and nothing is marked read. A failed step is an answer, never a retry —
 * each login counts toward MAX's too-many-logins pause (`MAX-38`).
 */
export const checkOnline = async (client: MaxClient, handshake: () => Promise<number>): Promise<Check[]> => {
  const checks: Check[] = []
  const step = async (name: string, body: () => Promise<string>): Promise<boolean> => {
    try {
      checks.push({ name, ok: true, detail: await body() })
      return true
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  const loggedIn = await step("login", async () => {
    await client.account.me()
    return "logged in"
  })
  if (loggedIn) await step("chats", async () => `${(await client.chats.list({ limit: 1 })).items.length} read`)
  await client.close()
  await step("mcp", async () => `${await handshake()} tools offered`)
  return checks
}

/**
 * Starts `max mcp` as `node <script>` — never `max`, which on Windows is a `.cmd` file Node does not
 * start without a shell — asks for its tools and closes stdin, which is how a client lets it exit.
 * Listing tools does not log in.
 */
export const mcpHandshake = async ({
  execPath,
  scriptPath,
  env,
}: {
  execPath: string
  scriptPath: string
  env: NodeJS.ProcessEnv
}): Promise<number> => {
  const { LATEST_PROTOCOL_VERSION } = await import("@modelcontextprotocol/server")
  const child = spawn(execPath, [scriptPath, "mcp"], { env, stdio: ["pipe", "pipe", "ignore"] })
  const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
  const lines = createInterface({ input: child.stdout })

  try {
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer in ${HANDSHAKE_MS / 1000} s`)), HANDSHAKE_MS)
      child.once("error", reject)
      child.once("exit", (code) => reject(new Error(`the server exited with code ${code}`)))
      lines.on("line", (line) => {
        let message: { id?: number; result?: { tools?: unknown[] }; error?: { message?: string } }
        try {
          message = JSON.parse(line)
        } catch {
          return
        }
        if (message.error) reject(new Error(message.error.message ?? "the server answered with an error"))
        else if (message.id === 1) {
          send({ method: "notifications/initialized" })
          send({ id: 2, method: "tools/list" })
        } else if (message.id === 2) resolve(message.result?.tools?.length ?? 0)
      })
      send({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "max-doctor", version: VERSION },
        },
      })
      child.once("exit", () => clearTimeout(timer))
    })
  } finally {
    lines.close()
    child.stdin.end()
    if (child.pid !== undefined && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve))
      const killer = setTimeout(() => child.kill(), 3000)
      await exited
      clearTimeout(killer)
    }
  }
}
