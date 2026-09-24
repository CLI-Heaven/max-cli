import { resolve } from "node:path"
import { CliError, writeSecurely } from "@leemour/cli-core"
import { Command, Option } from "commander"
import { openProfileCache } from "../cache/index.js"
import { toMarkdown, type Unread, unreadStretches } from "../export.js"
import { forCommand } from "./context.js"

const SHOWN_STRETCHES = 5

export const exportCommand = (): Command => {
  const command = new Command("export").description("write what this machine holds to a file; never connects")

  /**
   * **Reads the local copy and nothing else**, so an export can never turn into traffic to MAX.
   * What it cannot hold is said on stderr, stretch by stretch: a file that silently starts in the
   * middle of a conversation reads as the whole of it.
   *
   * ⚠ The file carries photo links that open without a login (`docs/architecture/messages.md`), so
   * `--output` writes it readable by the owner only, as the cache is.
   */
  command
    .command("messages")
    .argument("<chat>", "chat id, or part of a chat name this machine has listed")
    .description("a chat's messages from the local copy, oldest first, as JSON lines or Markdown")
    .addOption(new Option("--format <format>", "jsonl or md").choices(["jsonl", "md"]).makeOptionMandatory())
    .option("--since <id-or-time>", "only from this message id or ISO 8601 time on")
    .option("--output <file>", "write to this file, readable only by you, instead of stdout")
    .action(async function (this: Command, chat: string) {
      const options = this.opts<{ format: "jsonl" | "md"; since?: string; output?: string }>()
      const { renderer, settings, streams, createClient, run } = forCommand(this)
      const cache = await openProfileCache(settings.profile)
      if (!cache) throw new CliError("not_found", "the local copy could not be opened, and export reads nothing else")

      await run("export messages", async (events) => {
        const client = createClient({ events, cache, offline: true })
        try {
          const chatId = await client.chats.resolve(chat)
          const since = options.since === undefined ? undefined : client.messages.moment(options.since, "--since")
          const messages = cache.messages.all(chatId, since)
          const oldest = messages[0]
          const newest = messages.at(-1)
          if (!oldest || !newest) {
            throw new CliError(
              "not_found",
              `this machine holds no messages of chat ${chatId}${since === undefined ? "" : " from then on"} — ` +
                `\`max messages list ${chatId}\` reads some`,
            )
          }

          const known = cache.chats.read(Number.POSITIVE_INFINITY)?.find((one) => one.id === chatId)
          const last = known?.lastMessageAt ? Date.parse(known.lastMessageAt) : undefined
          const unread = unreadStretches(cache.messages.ranges(chatId), { since, last })

          const body =
            options.format === "md"
              ? toMarkdown(known?.title ?? `chat ${chatId}`, messages)
              : `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`

          for (const stretch of unread.slice(0, SHOWN_STRETCHES)) renderer.note(describe(stretch))
          if (unread.length > SHOWN_STRETCHES) renderer.note(`and ${unread.length - SHOWN_STRETCHES} more stretches`)
          if (unread[0]?.to === oldest.timestamp) {
            renderer.note(`\`max messages list ${chatId} --before ${oldest.id}\` reads further back`)
          }

          if (options.output === undefined) {
            streams.data(body.slice(0, -1))
            return
          }
          const path = resolve(options.output)
          writeSecurely(path, body, 0o600)
          renderer.result({
            chatId,
            format: options.format,
            path,
            count: messages.length,
            oldest: oldest.timestamp,
            newest: newest.timestamp,
            unread,
          })
        } finally {
          await client.close()
          cache.close()
        }
      })
    })

  return command
}

const describe = ({ from, to }: Unread): string =>
  from === null
    ? `not in the export: anything before ${to}, never read`
    : `not in the export: ${from} to ${to}, never read`
