import { isInputRequiredResult, type ServerContext } from "@modelcontextprotocol/server"
import { describe, expect, it, vi } from "vitest"
import type { MaxClient } from "../client.js"
import { confirmer } from "./confirm.js"

const fakeClient = () => {
  const send = vi.fn(async () => ({ id: "1" }))
  const client = {
    chats: { show: async () => ({ id: "111", title: "Team Alpha" }) },
    messages: { send },
  } as unknown as MaxClient
  return { client, send }
}

const retry = (state: string | undefined) =>
  ({
    mcpReq: {
      inputResponses: { confirm: { action: "accept", content: {} } },
      requestState: () => state,
    },
  }) as unknown as ServerContext

const firstCall = { mcpReq: { inputResponses: undefined, requestState: () => undefined } } as unknown as ServerContext

describe("the send confirmation", () => {
  it("refuses a confirmation carried over to another text", async () => {
    const confirm = confirmer()
    const { client, send } = fakeClient()

    const asked = await confirm(client, { chat: "111", text: "the text shown" }, firstCall)
    const state = isInputRequiredResult(asked) ? asked.requestState : undefined

    await expect(confirm(client, { chat: "111", text: "another text" }, retry(state))).rejects.toMatchObject({
      code: "confirmation_required",
    })
    expect(send).not.toHaveBeenCalled()
  })

  it("refuses a confirmation with no state, or state from another server", async () => {
    const { client, send } = fakeClient()
    const other = confirmer()
    const asked = await other(client, { chat: "111", text: "hello" }, firstCall)
    const foreign = isInputRequiredResult(asked) ? asked.requestState : undefined

    const confirm = confirmer()
    for (const state of [undefined, foreign]) {
      await expect(confirm(client, { chat: "111", text: "hello" }, retry(state))).rejects.toMatchObject({
        code: "confirmation_required",
      })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it("sends what the form showed, once the owner said yes", async () => {
    const confirm = confirmer()
    const { client, send } = fakeClient()

    const asked = await confirm(client, { chat: "111", text: "hello" }, firstCall)
    const state = isInputRequiredResult(asked) ? asked.requestState : undefined
    await confirm(client, { chat: "111", text: "hello" }, retry(state))

    expect(send).toHaveBeenCalledWith("111", "hello", {})
  })
})
