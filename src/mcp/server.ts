import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import type { CommandContext } from "../commands/context.js"
import { VERSION } from "../version.js"
import { instructions } from "./instructions.js"
import { MaxSession, type SessionOptions } from "./session.js"
import { registerTools } from "./tools.js"

export interface ServerOptions extends SessionOptions {
  allowSend: boolean
  confirmSend?: boolean
}

/**
 * A factory of servers over one session. `serveStdio` may build a probe instance and throw it away
 * before settling on the protocol era, so each call is a fresh server — and all of them share the
 * one connection to MAX, which is the thing that must not be opened twice.
 */
export const createMaxServer = (
  context: CommandContext,
  { allowSend, confirmSend = false, ...sessionOptions }: ServerOptions,
) => {
  const session = new MaxSession(context, sessionOptions)
  const build = (): McpServer => {
    const server = new McpServer(
      { name: "max", version: VERSION },
      { instructions: instructions({ allowSend, confirmSend, profile: context.settings.profile }) },
    )
    registerTools(server, session, { allowSend, confirmSend, defaultLimit: context.settings.limit })
    return server
  }
  return { session, build }
}

/**
 * Serves until the client closes stdin or the process is told to stop, then closes the socket to
 * MAX. **Returning is what lets the process exit**: the transport lets go of stdin, and the session
 * is the only other thing that could hold it open.
 */
export const serveOverStdio = async (context: CommandContext, options: ServerOptions): Promise<void> => {
  const { session, build } = createMaxServer(context, options)
  const handle = serveStdio(build, { onerror: (error) => context.renderer.note(`mcp: ${error.message}`) })

  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve)
    process.stdin.once("close", resolve)
    process.once("SIGINT", resolve)
    process.once("SIGTERM", resolve)
  })

  await handle.close()
  await session.close()
}
