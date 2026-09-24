import { Command } from "commander"
import { forCommand } from "./context.js"

export const mcpCommand = (): Command =>
  new Command("mcp")
    .description("serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add max -- max mcp`")
    .option("--allow-send", "offer the send tool; without it the server can only read")
    .action(async function (this: Command) {
      // Loaded here, not at the top: every other command would otherwise pay for the SDK and zod.
      const { serveOverStdio } = await import("../mcp/server.js")
      await serveOverStdio(forCommand(this), { allowSend: this.opts().allowSend === true })
    })
