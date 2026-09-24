import { CliError } from "@leemour/cli-core"
import { annotate } from "@leemour/cli-core/commands"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import type { PollMessage } from "../domain/models.js"
import { pollLines } from "../rendering/messages.js"
import { type CommandContext, forCommand } from "./context.js"

const show = ({ renderer, format, streams }: CommandContext, answer: PollMessage): void => {
  if (format === "pretty") streams.data(`${pollLines(answer.poll).join("\n")}\n`)
  else renderer.result(answer)
}

export const pollsCommand = (): Command => {
  const command = new Command("polls").description("vote in polls, close your own, create one")

  annotate(command.command("vote"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "id of the message that carries the poll")
    .argument("[answers...]", "answer ids, as `messages list` prints them in [brackets]")
    .option("--retract", "take your vote back, where the poll allows it")
    .description("vote in a poll, or take your vote back; the others see it unless the poll is anonymous")
    .action(async function (this: Command, chat: string, messageId: string, answers: string[]) {
      const retract = this.opts().retract === true
      if (retract && answers.length > 0) {
        throw new CliError("validation_error", "`--retract` takes no answers: it removes the vote you have")
      }
      if (!retract && answers.length === 0) {
        throw new CliError("validation_error", "name at least one answer id, or pass `--retract`")
      }
      const context = forCommand(this)
      const cache = await openProfileCache(context.settings.profile, {
        onProblem: (message) => context.renderer.note(message),
      })

      await context.run("polls vote", async (events) => {
        const client = context.createClient({ events, ...(cache ? { cache } : {}) })
        try {
          const chatId = await client.chats.resolve(chat)
          const ids = answers.map((answer) => answer.trim())
          show(context, await client.polls.vote(chatId, messageId.trim(), ids))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  annotate(command.command("close"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<message>", "id of your own message that carries the poll")
    .description("close your own poll; nobody can vote in it after that, and it cannot be reopened")
    .action(async function (this: Command, chat: string, messageId: string) {
      const context = forCommand(this)
      const cache = await openProfileCache(context.settings.profile, {
        onProblem: (message) => context.renderer.note(message),
      })

      await context.run("polls close", async (events) => {
        const client = context.createClient({ events, ...(cache ? { cache } : {}) })
        try {
          const chatId = await client.chats.resolve(chat)
          show(context, await client.polls.close(chatId, messageId.trim()))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  annotate(command.command("create"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<question>", "the question")
    .argument("<answers...>", "two answers or more")
    .option("--multiple", "people may pick several answers")
    .option("--anonymous", "nobody sees who voted for what")
    .option("--revote", "people may change their vote")
    .option("--silent", "send without a notification")
    .description("send a poll to a chat, as a message of its own")
    .action(async function (this: Command, chat: string, question: string, answers: string[]) {
      const options = this.opts()
      const context = forCommand(this)
      const cache = await openProfileCache(context.settings.profile, {
        onProblem: (message) => context.renderer.note(message),
      })

      await context.run("polls create", async (events) => {
        const client = context.createClient({ events, ...(cache ? { cache } : {}) })
        try {
          const chatId = await client.chats.resolve(chat)
          const sent = await client.polls.create(chatId, question, answers, {
            multiple: options.multiple === true,
            anonymous: options.anonymous === true,
            revote: options.revote === true,
            ...(options.silent === true ? { notify: false } : {}),
          })
          context.renderer.result(sent)
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  return command
}
