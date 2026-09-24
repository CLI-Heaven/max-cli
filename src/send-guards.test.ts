import { readFileSync } from "node:fs"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { sendGuard } from "./sends/guard.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { RecipientList, recipientsPathFor } from "./sends/recipients.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const TEXT = "a sentence that must never reach a file"

const messenger = () => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [
          { id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 },
          { id: 222, title: "Strangers", type: "CHAT", lastEventTime: 1789775000000 },
        ],
      },
      [Opcode.MSG_SEND]: { message: { id: 116762160362694583n, time: 1789776000000, sender: 10000001, text: TEXT } },
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
  const sends = () => max.sent.filter((request) => request.opcode === Opcode.MSG_SEND)
  return { max, environment, sends }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const journalOf = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

describe("sending", () => {
  it("without a list or a setting, sends as before and journals the send without its text", async () => {
    const { environment, sends } = messenger()
    const sent = await runWith(["g-open", "messages", "send", "222", TEXT, "--json"], environment)

    expect(sent.code).toBe(0)
    expect(sends()).toHaveLength(1)
    expect(journalOf("g-open")).toMatchObject([
      { profile: "g-open", chatId: "222", outcome: "sent", messageId: "116762160362694583", length: TEXT.length },
    ])
    expect(readFileSync(sendsPathFor("g-open"), "utf8")).not.toContain(TEXT)
  })

  it("from a read-only profile, refuses with 5 and never connects", async () => {
    const { max, environment } = messenger()
    await runWith(["g-read", "config", "set", "readOnly", "true"])

    const refused = await runWith(["g-read", "messages", "send", "111", TEXT, "--json"], environment)

    expect(refused.code).toBe(5)
    expect(refused.stdout).toBe("")
    expect(JSON.parse(refused.stderr).error.code).toBe("permission_error")
    expect(max.sent).toEqual([])
    expect(journalOf("g-read")).toMatchObject([{ chatId: "111", outcome: "refused", errorCode: "permission_error" }])
  })

  it("with the list on, sends only to the chats on it — by id or by name", async () => {
    const { environment, sends } = messenger()
    const added = await runWith(["g-list", "recipients", "add", "Friends", "--json"], environment)
    expect(JSON.parse(added.stdout)).toEqual({ id: "111", title: "Friends", added: true })

    const byId = await runWith(["g-list", "messages", "send", "222", TEXT, "--json"], environment)
    expect(byId.code).toBe(7)
    expect(JSON.parse(byId.stderr).error.message).toContain("recipients add 222")

    const byName = await runWith(["g-list", "messages", "send", "Strangers", TEXT, "--json"], environment)
    expect(byName.code).toBe(7)
    expect(sends()).toHaveLength(0)

    const allowed = await runWith(["g-list", "messages", "send", "Friends", TEXT, "--json"], environment)
    expect(allowed.code).toBe(0)
    expect(sends()).toHaveLength(1)

    await runWith(["g-list", "recipients", "off"])
    const reopened = await runWith(["g-list", "messages", "send", "222", TEXT, "--json"], environment)
    expect(reopened.code).toBe(0)
  })

  it("a list that is on and empty sends nowhere", async () => {
    const { environment, sends } = messenger()
    await runWith(["g-empty", "recipients", "add", "111"], environment)
    await runWith(["g-empty", "recipients", "remove", "Friends"])

    const listed = await runWith(["g-empty", "recipients", "list", "--json"])
    expect(JSON.parse(listed.stdout)).toEqual([])
    expect(listed.stderr).toContain("on and empty")

    expect((await runWith(["g-empty", "messages", "send", "111", TEXT], environment)).code).toBe(7)
    expect(sends()).toHaveLength(0)
  })

  it("stops at the hourly limit with 8, counting sends and not refusals", async () => {
    const { environment, sends } = messenger()
    await runWith(["g-limit", "config", "set", "sendsPerHour", "2"])

    expect((await runWith(["g-limit", "messages", "send", "111", "one"], environment)).code).toBe(0)
    expect((await runWith(["g-limit", "messages", "send", "111", "two"], environment)).code).toBe(0)
    const third = await runWith(["g-limit", "messages", "send", "111", "three", "--json"], environment)

    expect(third.code).toBe(8)
    expect(JSON.parse(third.stderr).error.message).toContain("the next send is possible at")
    expect(sends()).toHaveLength(2)
    expect((await runWith(["g-limit", "messages", "send", "111", "four"], environment)).code).toBe(8)
  })

  it("keeps the journal through `cache clear`, and `sends list` shows it newest first", async () => {
    const { environment } = messenger()
    await runWith(["g-keep", "messages", "send", "111", "first"], environment)
    await runWith(["g-keep", "config", "set", "readOnly", "true"])
    await runWith(["g-keep", "messages", "send", "111", "second"], environment)
    await runWith(["g-keep", "cache", "clear"])

    const listed = await runWith(["g-keep", "sends", "list", "--json"])
    expect(JSON.parse(listed.stdout).map((entry: { outcome: string }) => entry.outcome)).toEqual(["refused", "sent"])
  })
})

describe("the send guard", () => {
  const guardAt = (profile: string, time: string, sendsPerHour: number) =>
    sendGuard({
      profile,
      readOnly: false,
      readOnlyFrom: "default",
      sendsPerHour,
      journal: new SendJournal(sendsPathFor(profile)),
      recipients: new RecipientList(recipientsPathFor(profile)),
      warn: () => {},
      now: () => new Date(time),
    })

  it("forgets sends older than an hour, and names the moment the limit opens again", () => {
    const journal = new SendJournal(sendsPathFor("g-window"))
    for (const at of ["2026-09-24T08:00:00Z", "2026-09-24T09:10:00Z", "2026-09-24T09:20:00Z", "2026-09-24T09:30:00Z"]) {
      journal.append({ at, profile: "g-window", chatId: "111", outcome: "sent" })
    }

    expect(() => guardAt("g-window", "2026-09-24T09:40:00Z", 4).check("111")).not.toThrow()
    // Lowered below what the hour holds: it opens when enough sends have aged out, not the first.
    expect(() => guardAt("g-window", "2026-09-24T09:40:00Z", 2).check("111")).toThrow("at 2026-09-24T10:20:00.000Z")
  })
})
