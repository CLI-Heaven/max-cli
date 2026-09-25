import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { CliError } from "@leemour/cli-core"
import {
  type InputRequiredResult,
  inputRequired,
  inputResponse,
  type ServerContext,
} from "@modelcontextprotocol/server"
import type { MaxClient } from "../client.js"
import { sendTime } from "../config.js"

export interface SendArgs {
  chat: string
  text: string
  silent?: boolean
  cid?: number
  at?: string
}

/** The one mapping from tool arguments to a send, for both the plain tool and the confirmed one. */
export const sendOptions = (args: SendArgs, at: number | undefined) => ({
  ...(args.cid === undefined ? {} : { cid: args.cid }),
  ...(args.silent === true ? { notify: false } : {}),
  ...(at === undefined ? {} : { at }),
})

/** The arguments that name a chat: each is shown as the chat it resolved to, and sealed as its id. */
const CHAT_ARGUMENTS = ["chat", "to"]
const VALID_MS = 5 * 60 * 1000

type Arguments = Record<string, unknown>

/**
 * **`--confirm-send`: the server asks the owner itself, for every write, and shows where the names
 * resolved to** (`CLI-28`).
 *
 * The client's own approval shows the arguments as the model wrote them — `chat: "Team"`. The form
 * shows the chat that name became and the whole text, which is what the owner is actually agreeing
 * to. The first call writes nothing; the SDK shows the form and calls again with the answer.
 *
 * The answer is bound to what the form showed: `requestState` carries an HMAC of the tool, every
 * argument with its chats resolved, a nonce and an expiry, under a key that never leaves this
 * process. The state round-trips through the client, so without the key an answer given for one
 * message could be carried to another, or to another tool; the nonce is spent on first use, so a
 * yes cannot be replayed. A client that cannot show a form fails the call in the SDK, before the
 * second call — nothing is written.
 */
export const confirmer = ({ now = () => Date.now() }: { now?: () => number } = {}) => {
  const key = randomBytes(32)
  const issued = new Map<string, number>()

  const seal = (tool: string, args: Arguments, nonce: string, expires: number) =>
    createHmac("sha256", key)
      .update(JSON.stringify([tool, Object.entries(args).sort(([a], [b]) => a.localeCompare(b)), nonce, expires]))
      .digest("base64url")

  const matches = (given: string, expected: string): boolean =>
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))

  return async (
    tool: { name: string; title: string },
    client: MaxClient,
    args: Arguments,
    ctx: ServerContext,
    act: (resolved: Arguments) => Promise<object>,
  ): Promise<object | InputRequiredResult> => {
    for (const [nonce, expires] of issued) if (expires < now()) issued.delete(nonce)

    const shown: string[] = []
    const resolved: Arguments = { ...args }
    for (const name of CHAT_ARGUMENTS) {
      if (typeof args[name] !== "string") continue
      const chat = await client.chats.show(args[name])
      resolved[name] = chat.id
      shown.push(`${name}: ${JSON.stringify(chat.title ?? chat.id)} (${chat.id})`)
    }
    for (const [name, value] of Object.entries(args)) {
      if (CHAT_ARGUMENTS.includes(name) || name === "text") continue
      shown.push(
        `${name}: ${name === "at" && typeof value === "string" ? new Date(sendTime(value)).toISOString() : JSON.stringify(value)}`,
      )
    }
    if (typeof args.text === "string") shown.push("", args.text)

    const answer = inputResponse(ctx.mcpReq.inputResponses, "confirm")
    if (answer.kind === "missing") {
      const nonce = randomBytes(16).toString("base64url")
      const expires = now() + VALID_MS
      issued.set(nonce, expires)
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `${tool.title}?\n\n${shown.join("\n")}`,
            requestedSchema: { type: "object", properties: {} },
          }),
        },
        requestState: `${nonce}.${expires}.${seal(tool.name, resolved, nonce, expires)}`,
      })
    }

    if (answer.kind !== "elicit" || answer.action !== "accept") {
      throw new CliError(
        "confirmation_required",
        "the owner did not confirm this — nothing was written; do not retry it",
      )
    }
    const [nonce = "", expiresText = "", mac = ""] = (ctx.mcpReq.requestState<string>() ?? "").split(".")
    const expires = Number(expiresText)
    if (!issued.has(nonce) || issued.get(nonce) !== expires || expires < now()) {
      throw new CliError(
        "confirmation_required",
        "the confirmation has expired, was already used, or is not from this server — nothing was written",
      )
    }
    if (!matches(mac, seal(tool.name, resolved, nonce, expires))) {
      throw new CliError(
        "confirmation_required",
        "the confirmation was given for another tool, chat or text — nothing was written",
      )
    }
    issued.delete(nonce)
    return act(resolved)
  }
}
