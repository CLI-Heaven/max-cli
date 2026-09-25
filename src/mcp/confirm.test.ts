import { isInputRequiredResult, type ServerContext } from "@modelcontextprotocol/server"
import { describe, expect, it, vi } from "vitest"
import type { MaxClient } from "../client.js"
import { confirmer } from "./confirm.js"

const client = {
  chats: {
    show: async (reference: string) => ({ id: reference === "Alpha" ? "111" : reference, title: "Team Alpha" }),
  },
} as unknown as MaxClient

const SEND = { name: "max_messages_send", title: "Send a message" }
const FORWARD = { name: "max_messages_forward", title: "Forward a message" }

const retry = (state: string | undefined) =>
  ({
    mcpReq: {
      inputResponses: { confirm: { action: "accept", content: {} } },
      requestState: () => state,
    },
  }) as unknown as ServerContext

const firstCall = { mcpReq: { inputResponses: undefined, requestState: () => undefined } } as unknown as ServerContext

const ask = async (confirm: ReturnType<typeof confirmer>, tool: typeof SEND, args: Record<string, unknown>) => {
  const asked = await confirm(tool, client, args, firstCall, async () => ({}))
  return isInputRequiredResult(asked) ? asked.requestState : undefined
}

describe("the write confirmation", () => {
  it("writes what the form showed, with the chat as the id it resolved to, once the owner said yes", async () => {
    const confirm = confirmer()
    const act = vi.fn(async () => ({ id: "1" }))
    const state = await ask(confirm, SEND, { chat: "Alpha", text: "hello" })

    await confirm(SEND, client, { chat: "Alpha", text: "hello" }, retry(state), act)

    expect(act).toHaveBeenCalledWith({ chat: "111", text: "hello" })
  })

  it.each([
    ["another text", SEND, { chat: "111", text: "another text" }],
    ["the same text, silent", SEND, { chat: "111", text: "hello", silent: true }],
    ["another tool", FORWARD, { chat: "111", text: "hello" }],
  ])("refuses a yes carried over to %s", async (_, tool, args) => {
    const confirm = confirmer()
    const act = vi.fn(async () => ({}))
    const state = await ask(confirm, SEND, { chat: "111", text: "hello" })

    await expect(confirm(tool, client, args, retry(state), act)).rejects.toMatchObject({
      code: "confirmation_required",
    })
    expect(act).not.toHaveBeenCalled()
  })

  it("refuses a yes with no state, or state from another server", async () => {
    const foreign = await ask(confirmer(), SEND, { chat: "111", text: "hello" })
    const confirm = confirmer()
    const act = vi.fn(async () => ({}))

    for (const state of [undefined, foreign]) {
      await expect(confirm(SEND, client, { chat: "111", text: "hello" }, retry(state), act)).rejects.toMatchObject({
        code: "confirmation_required",
      })
    }
    expect(act).not.toHaveBeenCalled()
  })

  it("writes once for one yes: the same accepted state replayed writes nothing", async () => {
    const confirm = confirmer()
    const act = vi.fn(async () => ({}))
    const state = await ask(confirm, SEND, { chat: "111", text: "hello" })

    await confirm(SEND, client, { chat: "111", text: "hello" }, retry(state), act)
    await expect(confirm(SEND, client, { chat: "111", text: "hello" }, retry(state), act)).rejects.toMatchObject({
      code: "confirmation_required",
    })
    expect(act).toHaveBeenCalledTimes(1)
  })

  it("refuses a yes given more than five minutes after the form", async () => {
    let time = Date.parse("2026-09-25T10:00:00Z")
    const confirm = confirmer({ now: () => time })
    const act = vi.fn(async () => ({}))
    const state = await ask(confirm, SEND, { chat: "111", text: "hello" })

    time += 5 * 60 * 1000 + 1
    await expect(confirm(SEND, client, { chat: "111", text: "hello" }, retry(state), act)).rejects.toMatchObject({
      code: "confirmation_required",
    })
    expect(act).not.toHaveBeenCalled()
  })
})
