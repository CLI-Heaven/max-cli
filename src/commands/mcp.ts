import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { forCommand } from "./context.js"

export const mcpCommand = (): Command =>
  new Command("mcp")
    .description("serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add max -- max mcp`")
    .option("--allow-send", "offer the send tool; without it the server can only read")
    .option(
      "--confirm-send",
      "show the owner each send in a form from the server — the chat it resolved to and the text",
    )
    .option("--allow-mark-read", "offer the tool that marks a chat read; the other person sees it")
    .option("--allow-delete", "offer the tool that deletes messages for you only; it cannot be undone")
    .action(async function (this: Command) {
      const { allowSend, confirmSend, allowMarkRead, allowDelete } = this.opts<{
        allowSend?: boolean
        confirmSend?: boolean
        allowMarkRead?: boolean
        allowDelete?: boolean
      }>()
      if (confirmSend && !allowSend) {
        throw new CliError(
          "validation_error",
          "`--confirm-send` confirms sends, and without `--allow-send` there are none",
        )
      }
      // Loaded here, not at the top: every other command would otherwise pay for the SDK and zod.
      const { serveOverStdio } = await import("../mcp/server.js")
      await serveOverStdio(forCommand(this), {
        allowSend: allowSend === true,
        confirmSend: confirmSend === true,
        allowMarkRead: allowMarkRead === true,
        allowDelete: allowDelete === true,
      })
    })
