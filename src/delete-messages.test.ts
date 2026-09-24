import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const FIRST = "116762160362694580"
const SECOND = "116762160362694583"

const messenger = () => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001 } },
        chats: [{ id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 }],
      },
      [Opcode.MSG_DELETE]: {},
    },
  })
  const keyring = memoryKeyring()
  const environment: Environment = {
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  }
  const deletes = () =>
    max.sent
      .filter(({ opcode }) => opcode === Opcode.MSG_DELETE)
      .map(({ payload }) => ({
        chatId: String(payload.chatId),
        messageIds: (payload.messageIds as unknown[]).map(String),
        forMe: payload.forMe,
      }))
  return { max, environment, deletes }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run([...argv, "--json"], { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const journalOf = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

describe("deleting messages", () => {
  it("**refuses without --allow-dangerous**, before connecting", async () => {
    const { max, environment } = messenger()
    const { code, stderr } = await runWith(["d-word", "messages", "delete", "111", FIRST], environment)

    expect(code).toBe(7)
    expect(stderr).toContain("--allow-dangerous")
    expect(max.sent).toEqual([])
  })

  it("deletes for the owner only unless told otherwise, and journals it without text", async () => {
    const { environment, deletes } = messenger()
    const { code, stdout } = await runWith(
      ["d-me", "messages", "delete", "Friends", FIRST, SECOND, "--allow-dangerous"],
      environment,
    )

    expect(code).toBe(0)
    expect(deletes()).toEqual([{ chatId: "111", messageIds: [FIRST, SECOND], forMe: true }])
    expect(JSON.parse(stdout)).toEqual({ chatId: "111", deleted: [FIRST, SECOND], forEveryone: false })
    expect(journalOf("d-me")).toMatchObject([
      { chatId: "111", kind: "delete", outcome: "sent", count: 2, forEveryone: false },
    ])
  })

  it("deletes for everyone only with --for-everyone", async () => {
    const { environment, deletes } = messenger()
    await runWith(["d-all", "messages", "delete", "111", FIRST, "--for-everyone", "--allow-dangerous"], environment)

    expect(deletes()).toEqual([{ chatId: "111", messageIds: [FIRST], forMe: false }])
  })

  it("**counts each deleted message toward the hourly limit**", async () => {
    const { environment, deletes } = messenger()
    await runWith(["d-limit", "config", "set", "sendsPerHour", "3"])

    expect(
      (await runWith(["d-limit", "messages", "delete", "111", FIRST, SECOND, "--allow-dangerous"], environment)).code,
    ).toBe(0)
    expect(
      (await runWith(["d-limit", "messages", "delete", "111", FIRST, SECOND, "--allow-dangerous"], environment)).code,
    ).toBe(8)
    expect(deletes()).toHaveLength(1)
  })

  it("refuses more than ten at once, before connecting", async () => {
    const { max, environment } = messenger()
    const eleven = Array.from({ length: 11 }, (_, index) => String(116762160362694500n + BigInt(index)))
    const { code } = await runWith(["d-many", "messages", "delete", "111", ...eleven, "--allow-dangerous"], environment)

    expect(code).toBe(2)
    expect(max.sent.map(({ opcode }) => opcode)).not.toContain(Opcode.MSG_DELETE)
  })

  it("a read-only profile refuses before connecting", async () => {
    const { max, environment } = messenger()
    await runWith(["d-ro", "config", "set", "readOnly", "true"])

    expect((await runWith(["d-ro", "messages", "delete", "111", FIRST, "--allow-dangerous"], environment)).code).toBe(5)
    expect(max.sent).toEqual([])
  })
})
