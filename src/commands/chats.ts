import { CliError } from "@leemour/cli-core"
import { annotate } from "@leemour/cli-core/commands"
import { Command } from "commander"
import { openProfileCache } from "../cache/index.js"
import { ADMIN_RIGHTS, type AdminRight, type MaxClient } from "../client.js"
import type { ChatKind, GroupSettings } from "../domain/models.js"
import { forCommand } from "./context.js"
import { foldersCommand } from "./folders.js"
import { renderPage, window, withPaging } from "./paging.js"

export const chatsCommand = (): Command => {
  const command = new Command("chats").description("the chats this account is in")

  withPaging(command.command("list").description("the chats this account is in"))
    .option("--search <text>", "only chats whose name contains this; at least 3 characters")
    .option("--kind <dialog|group|channel>", "only chats of this kind")
    .option("--unread", "only chats with unread messages")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals()
      const context = forCommand(this)
      const { renderer, settings, createClient, run } = context
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("chats list", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderPage(
            context,
            await client.chats.list({
              ...window(settings),
              ...(options.search === undefined ? {} : { query: String(options.search) }),
              ...(options.kind === undefined ? {} : { kind: chatKind(options.kind) }),
              ...(options.unread === true ? { unread: true } : {}),
            }),
          )
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  command
    .command("show")
    .argument("<chat>", "chat id, or part of a chat name")
    .description("one chat: its kind, unread count, last message time and who is in it")
    .action(async function (this: Command, chat: string) {
      const { renderer, settings, createClient, run } = forCommand(this)
      const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

      await run("chats show", async (events) => {
        const client = createClient({ events, ...(cache ? { cache } : {}) })

        try {
          renderer.result(await client.chats.show(chat))
        } finally {
          await client.close()
          cache?.close()
        }
      })
    })

  command
    .command("inspect")
    .argument("<link>", "an invite link, https://max.ru/join/…, or a public one, https://max.ru/<name>")
    .description("what a link leads to, without joining it")
    .action(async function (this: Command, link: string) {
      await withClient(this, "chats inspect", (client) => client.chats.inspect(link))
    })

  annotate(command.command("join"), { mutates: true })
    .argument("<link>", "an invite link, https://max.ru/join/…, or a public one, https://max.ru/<name>")
    .description("join a group or channel by its link; the others in it see that you joined")
    .action(async function (this: Command, link: string) {
      await withClient(this, "chats join", (client) => client.chats.join(link))
    })

  annotate(command.command("leave"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .description("leave a group or channel; the others in it see that you left")
    .action(async function (this: Command, chat: string) {
      await withClient(this, "chats leave", (client) => client.chats.leave(chat))
    })

  annotate(command.command("create"), { mutates: true })
    .argument("<title>", "the group's name")
    .argument("[person...]", "people to add: an id, or part of a name")
    .description("create a group; the people added are told")
    .action(async function (this: Command, title: string, people: string[]) {
      await withClient(this, "chats create", (client) => client.chats.create(title, people))
    })

  const members = command.command("members").description("add people to a group or channel, or remove them")
  annotate(members.command("add"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<person...>", "an id, or part of a name")
    .option("--hide-history", "the people added do not see the messages from before they came")
    .description("add people; they are told")
    .action(async function (this: Command, chat: string, people: string[]) {
      const history = this.opts().hideHistory !== true
      await withClient(this, "chats members add", (client) => client.chats.members.add(chat, people, { history }))
    })
  annotate(members.command("remove"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<person...>", "an id, or part of a name")
    .description("remove people; their messages stay")
    .action(async function (this: Command, chat: string, people: string[]) {
      await withClient(this, "chats members remove", (client) => client.chats.members.remove(chat, people))
    })

  const admins = command.command("admins").description("give or take back a member's admin rights")
  annotate(admins.command("add"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<person>", "an id, or part of a name")
    .requiredOption("--can <rights>", `what they may do, comma-separated: ${Object.keys(ADMIN_RIGHTS).join(", ")}`)
    .description("make a member an admin with these rights")
    .action(async function (this: Command, chat: string, person: string) {
      const rights = adminRights(String(this.opts().can))
      await withClient(this, "chats admins add", (client) => client.chats.admins.add(chat, person, rights))
    })

  annotate(admins.command("remove"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<person>", "an id, or part of a name")
    .description("take an admin's rights back; they stay a member")
    .action(async function (this: Command, chat: string, person: string) {
      await withClient(this, "chats admins remove", (client) => client.chats.admins.remove(chat, person))
    })

  annotate(command.command("update"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .option("--title <title>", "the new name")
    .option("--description <text>", "the new description")
    .description("rename a group or channel, or change its description")
    .action(async function (this: Command, chat: string) {
      const { title, description } = this.opts() as { title?: string; description?: string }
      await withClient(this, "chats update", (client) =>
        client.chats.update(chat, {
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
        }),
      )
    })

  const settingsCommand = annotate(command.command("settings"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .description("a group's settings; with an option, change that one")
  for (const [flag, , help] of SETTINGS) settingsCommand.option(`--${flag} <on|off>`, help)
  settingsCommand.action(async function (this: Command, chat: string) {
    const changes = settingChanges(this.opts())
    await withClient(this, "chats settings", (client) => client.chats.settings(chat, changes))
  })

  const requests = command.command("requests").description("people asking to join a group or channel")
  requests
    .command("list")
    .argument("<chat>", "chat id, or part of a chat name")
    .description("who is asking to join")
    .action(async function (this: Command, chat: string) {
      await withClient(this, "chats requests list", (client) => client.chats.requests.list(chat))
    })
  annotate(requests.command("accept"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<person...>", "an id from `requests list`")
    .description("let them in")
    .action(async function (this: Command, chat: string, people: string[]) {
      await withClient(this, "chats requests accept", (client) => client.chats.requests.accept(chat, people))
    })
  annotate(requests.command("decline"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .argument("<person...>", "an id from `requests list`")
    .description("turn them down")
    .action(async function (this: Command, chat: string, people: string[]) {
      await withClient(this, "chats requests decline", (client) => client.chats.requests.decline(chat, people))
    })

  const link = command.command("link").description("a group's invite link")
  annotate(link.command("reset"), { mutates: true })
    .argument("<chat>", "chat id, or part of a chat name")
    .description("replace the invite link; the old one stops working")
    .action(async function (this: Command, chat: string) {
      await withClient(this, "chats link reset", (client) => client.chats.resetLink(chat))
    })
  command.addCommand(foldersCommand())

  return command
}

const withClient = async (command: Command, label: string, act: (client: MaxClient) => Promise<unknown>) => {
  const { renderer, settings, createClient, run } = forCommand(command)
  const cache = await openProfileCache(settings.profile, { onProblem: (message) => renderer.note(message) })

  await run(label, async (events) => {
    const client = createClient({ events, ...(cache ? { cache } : {}) })
    try {
      renderer.result(await act(client))
    } finally {
      await client.close()
      cache?.close()
    }
  })
}

const SETTINGS: [flag: string, key: keyof GroupSettings, help: string][] = [
  ["all-can-pin", "allCanPin", "every member may pin messages"],
  ["only-admins-add", "onlyAdminsAdd", "only admins may add members"],
  ["only-admins-call", "onlyAdminsCall", "only admins may start a call"],
  ["only-owner-edits-info", "onlyOwnerEditsInfo", "only the owner may change the name and photo"],
  ["members-see-link", "membersSeeLink", "members may see the invite link"],
]

const settingChanges = (options: Record<string, unknown>): Partial<GroupSettings> => {
  const changes: Partial<GroupSettings> = {}
  for (const [flag, key] of SETTINGS) {
    const value = options[key]
    if (value === undefined) continue
    if (value !== "on" && value !== "off") {
      throw new CliError("validation_error", `--${flag} takes on or off, not "${String(value)}"`)
    }
    changes[key] = value === "on"
  }
  return changes
}

const adminRights = (value: string): AdminRight[] => {
  const rights = value
    .split(",")
    .map((right) => right.trim())
    .filter((right) => right !== "")
  const unknown = rights.filter((right) => !(right in ADMIN_RIGHTS))
  if (rights.length === 0 || unknown.length > 0) {
    throw new CliError(
      "validation_error",
      `--can takes ${Object.keys(ADMIN_RIGHTS).join(", ")}${unknown.length > 0 ? `, not "${unknown.join(", ")}"` : ""}`,
    )
  }
  return rights as AdminRight[]
}

/**
 * `--kind` is checked here and refused by name, rather than passed through to return nothing.
 *
 * A value the tool does not know is a typo, and an empty list is the one answer a typo must never
 * produce — it is indistinguishable from "you are in no group chats".
 */
const chatKind = (value: unknown): ChatKind => {
  const wanted = String(value).toLowerCase()
  if (wanted === "dialog" || wanted === "group" || wanted === "channel") return wanted
  throw new CliError("validation_error", `--kind takes dialog, group or channel, not "${String(value)}"`)
}
