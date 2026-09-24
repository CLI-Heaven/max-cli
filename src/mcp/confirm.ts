import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { CliError } from "@leemour/cli-core"
import {
  type InputRequiredResult,
  inputRequired,
  inputResponse,
  type ServerContext,
} from "@modelcontextprotocol/server"
import type { MaxClient } from "../client.js"
import type { Message } from "../domain/models.js"

export interface SendArgs {
  chat: string
  text: string
  silent?: boolean
  cid?: number
}

/**
 * **`--confirm-send`: the server asks the owner itself, and shows where the name resolved to** (`CLI-28`).
 *
 * The client's own approval shows the arguments as the model wrote them — `chat: "Team"`. The form
 * shows the chat that name became and the whole text, which is what the owner is actually agreeing
 * to. The first call sends nothing; the SDK shows the form and calls again with the answer.
 *
 * The answer is bound to what the form showed: `requestState` carries an HMAC of chat and text under
 * a key that never leaves this process, and the second call recomputes it from its own arguments.
 * The state round-trips through the client, so without the key an answer given for one message
 * could be carried to another. A client that cannot show a form fails the call in the SDK, before
 * the second call — nothing is sent.
 */
export const confirmer = () => {
  const key = randomBytes(32)
  const seal = (chatId: string, text: string) => createHmac("sha256", key).update(`${chatId}\n${text}`).digest()

  const matches = (state: string | undefined, expected: Buffer): boolean => {
    if (state === undefined) return false
    const given = Buffer.from(state, "base64url")
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  return async (client: MaxClient, args: SendArgs, ctx: ServerContext): Promise<Message | InputRequiredResult> => {
    const chat = await client.chats.show(args.chat)
    const expected = seal(chat.id, args.text)
    const answer = inputResponse(ctx.mcpReq.inputResponses, "confirm")

    if (answer.kind === "missing") {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `Send to "${chat.title ?? chat.id}" (${chat.id})?\n\n${args.text}`,
            requestedSchema: { type: "object", properties: {} },
          }),
        },
        requestState: expected.toString("base64url"),
      })
    }

    if (answer.kind !== "elicit" || answer.action !== "accept") {
      throw new CliError(
        "confirmation_required",
        "the owner did not confirm this send — nothing was sent; do not retry it",
      )
    }
    if (!matches(ctx.mcpReq.requestState<string>(), expected)) {
      throw new CliError(
        "confirmation_required",
        "the confirmation was given for another chat or text — nothing was sent",
      )
    }

    return client.messages.send(chat.id, args.text, {
      ...(args.cid === undefined ? {} : { cid: args.cid }),
      ...(args.silent === true ? { notify: false } : {}),
    })
  }
}
