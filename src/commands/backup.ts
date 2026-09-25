import { CliError } from "@leemour/cli-core"
import { Command } from "commander"
import { estimateBackup } from "../backup.js"
import { openProfileCache } from "../cache/index.js"
import { BACKUP_PAGE } from "../client.js"
import { forCommand } from "./context.js"

const MAX_PAGES = 40
/** web.max.ru sets no pause; a person scrolling the owner's chat paged every 5.3–5.4 s (`RES-9`, `NEED-216` A). */
const PAUSE_SECONDS = 5

export const backupCommand = (): Command => {
  const command = new Command("backup").description("bring a chat's history into this machine's copy, within limits")

  /**
   * **Without `--run` it only prices the work**, from the local copy and with no login, so the
   * owner sees what a backup costs before MAX sees any of it. `--run` is the same line with one
   * more word. Not in MCP: a bulk read is not an agent's call to make.
   */
  command
    .command("messages")
    .argument("<chat>", "chat id, or part of a chat name")
    .description("what a chat's history back to --since or --last costs; with --run, fetch it")
    .option("--since <id-or-time>", "back to this message id or ISO 8601 time")
    .option("--last <n>", "the newest n messages", (value) => Number.parseInt(value, 10))
    .option("--run", "fetch what is missing; without it nothing is sent")
    .option("--max-pages <n>", `pages of ${BACKUP_PAGE} per run`, (value) => Number.parseInt(value, 10), MAX_PAGES)
    .option("--pause <seconds>", "the least wait between pages; each is up to twice that", Number, PAUSE_SECONDS)
    .action(async function (this: Command, chat: string) {
      const options = this.opts<{ since?: string; last?: number; run?: boolean; maxPages: number; pause: number }>()
      if ((options.since === undefined) === (options.last === undefined)) {
        throw new CliError("validation_error", "give --since or --last: how far back the backup goes")
      }
      if (options.last !== undefined && !(options.last > 0)) {
        throw new CliError("validation_error", "--last takes a count above zero")
      }
      if (!(options.maxPages > 0)) throw new CliError("validation_error", "--max-pages takes a count above zero")
      if (!(options.pause >= 0)) throw new CliError("validation_error", "--pause takes seconds, zero or more")

      const { renderer, settings, createClient, run } = forCommand(this)
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })
      if (!cache) throw new CliError("not_found", "the local copy could not be opened, and a backup is kept there")

      await run("backup messages", async (events) => {
        const client = createClient({ events, cache, offline: options.run !== true })
        try {
          const chatId = await client.chats.resolve(chat)
          const since = options.since === undefined ? undefined : client.messages.moment(options.since, "--since")
          const window = {
            ...(since === undefined ? {} : { since }),
            ...(options.last === undefined ? {} : { last: options.last }),
          }

          if (options.run !== true) {
            const known = cache.chats.read(Number.POSITIVE_INFINITY)?.find((one) => one.id === chatId)
            const estimate = estimateBackup({
              ranges: cache.messages.ranges(chatId),
              count: (from) => cache.messages.count(chatId, from),
              newest: known?.lastMessageAt ? Date.parse(known.lastMessageAt) : Date.now(),
              ...window,
              maxPages: options.maxPages,
              pauseSeconds: options.pause,
            })
            renderer.note("an estimate from this machine's copy; nothing was sent — add --run to fetch")
            renderer.result({ chatId, run: false, maxPages: options.maxPages, ...estimate })
            return
          }

          // Any number resolves; an id that is no chat must not come back as a history read to its start.
          if (!(await client.chats.list()).items.some((one) => one.id === chatId)) {
            throw new CliError("not_found", `no chat ${chatId} among this account's chats`)
          }

          const before = cache.messages.count(chatId, since ?? 0)
          let outcome: Awaited<ReturnType<typeof client.messages.backup>>
          try {
            outcome = await client.messages.backup(chatId, {
              ...window,
              maxPages: options.maxPages,
              pause: () => new Promise((resolve) => setTimeout(resolve, options.pause * 1000 * (1 + Math.random()))),
              onPage: ({ number, count, oldest }) =>
                renderer.note(`page ${number}: ${count} messages${oldest ? `, back to ${oldest}` : ""}`),
            })
          } catch (error) {
            renderer.note("stopped on the first error; what was read stays here, and the same command continues")
            throw error
          }

          const held = cache.messages.count(chatId, since ?? 0)
          if (!outcome.complete) {
            renderer.note(`stopped after ${outcome.pages} pages, the limit of one run — the same command continues`)
          }
          renderer.result({ chatId, run: true, ...outcome, fetched: held - before, held })
        } finally {
          await client.close()
          cache.close()
        }
      })
    })

  return command
}
