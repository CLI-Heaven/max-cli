import { Command } from "commander"
import { serveOverStdio } from "../mcp/server.js"
import { forCommand } from "./context.js"

export const mcpCommand = (): Command =>
  new Command("mcp")
    .description("serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add max -- max mcp`")
    .option("--allow-send", "offer the send tool; without it the server can only read")
    .action(async function (this: Command) {
      await serveOverStdio(forCommand(this), { allowSend: this.opts().allowSend === true })
    })
