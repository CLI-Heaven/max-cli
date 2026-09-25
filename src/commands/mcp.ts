import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { forCommand } from "./context.js"

export const mcpCommand = (): Command =>
  new Command("mcp")
    .description("serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add max -- max mcp`")
    .option("--allow-send", "offer the send tool; without it the server can only read")
    .option(
      "--confirm-send",
      "show the owner every send, edit, forward, pin, mark-read and delete in a form from the server first",
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
      if (confirmSend && !allowSend && !allowMarkRead && !allowDelete) {
        throw new CliError(
          "validation_error",
          "`--confirm-send` confirms writes, and without `--allow-send`, `--allow-mark-read` or `--allow-delete` there are none",
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
