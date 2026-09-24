import { readFileSync } from "node:fs"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { resolveSettings } from "./config.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { sendGuard } from "./sends/guard.js"
import { type AccountAction, type ChatAction, SendJournal, type SendKind, sendsPathFor } from "./sends/journal.js"
import { type Permission, permissionFor } from "./sends/permissions.js"
import { RecipientList, recipientsPathFor } from "./sends/recipients.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const guardFor = (profile: string, allow: readonly Permission[] | undefined, readOnly = false) =>
  sendGuard({
    profile,
    readOnly,
    readOnlyFrom: "config file",
    ...(allow ? { allow, allowFrom: "config file" } : {}),
    sendsPerHour: 1000,
    journal: new SendJournal(sendsPathFor(profile)),
    recipients: new RecipientList(recipientsPathFor(profile)),
    warn: () => {},
  })

describe("which permission an action needs", () => {
  const cases: [SendKind, ChatAction | AccountAction | undefined, Permission][] = [
    ["message", undefined, "send"],
    ["forward", undefined, "forward"],
    ["reaction", undefined, "reaction"],
    ["edit", undefined, "edit"],
    ["pin", undefined, "pin"],
    ["read", undefined, "read"],
    ["delete", undefined, "delete"],
    ["chat", "create", "groups"],
    ["chat", "admins.add", "groups"],
    ["account", "contact-import", "contacts"],
    ["account", "profile", "profile"],
    ["account", "folder-delete", "folders"],
    ["account", "sessions-end", "sessions"],
  ]

  it.each(cases)("%s %s needs %s, and nothing else lets it through", (kind, action, permission) => {
    expect(permissionFor(kind, action)).toBe(permission)
    expect(() => guardFor(`p-${permission}`, [permission]).check("111", kind, action)).not.toThrow()
    const others = cases.map(([, , p]) => p).filter((p) => p !== permission)
    expect(() => guardFor(`p-not-${permission}`, others).check("111", kind, action)).toThrow(
      `does not allow ${permission}`,
    )
  })

  it("lets everything through without a list, as before", () => {
    for (const [kind, action] of cases)
      expect(() => guardFor("p-all", undefined).check("111", kind, action)).not.toThrow()
  })

  it("refuses everything with an empty list, and read-only wins over any list", () => {
    expect(() => guardFor("p-empty", []).check("111", "reaction")).toThrow("allow: nothing")
    expect(() => guardFor("p-ro", ["send"], true).check("111", "message")).toThrow("is read-only")
  })
})

const messenger = () => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [{ id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 }],
      },
      [Opcode.MSG_SEND]: { message: { id: 116762160362694583n, time: 1789776000000, sender: 10000001, text: "hi" } },
      [Opcode.MSG_REACTION]: { reactionInfo: { counters: [{ count: 1, reaction: "👍" }], totalCount: 1 } },
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
  return { max, environment }
}

describe("a profile with an allow list", () => {
  it("takes send,reaction as the owner types it, and a JSON list the same", async () => {
    expect((await runWith(["p-typed", "config", "set", "allow", "send, reaction"])).code).toBe(0)
    expect((await runWith(["p-json", "config", "set", "allow", '["send","reaction"]'])).code).toBe(0)

    const saved = JSON.parse(readFileSync(join(process.env.MAX_CONFIG_DIR ?? "", "config.json"), "utf8"))
    expect(saved.profiles["p-typed"].allow).toEqual(["send", "reaction"])
    expect(saved.profiles["p-json"].allow).toEqual(["send", "reaction"])
  })

  it("shows the list in config show, and says all when there is none", async () => {
    await runWith(["p-show", "config", "set", "allow", "send"])
    const shown = (profile: string) =>
      runWith([profile, "config", "show", "--json"]).then(({ stdout }) =>
        JSON.parse(stdout).settings.find((s: { setting: string }) => s.setting === "allow"),
      )

    expect(await shown("p-show")).toEqual({ setting: "allow", value: ["send"], from: "config file" })
    expect(await shown("p-none")).toEqual({ setting: "allow", value: "all", from: "default" })
  })

  it("refuses an action name it does not know, and lists the ones it does", async () => {
    const refused = await runWith(["p-typo", "config", "set", "allow", "send,delet", "--json"])

    expect(refused.code).not.toBe(0)
    expect(JSON.parse(refused.stderr).error.message).toContain("send, forward, reaction, edit, pin, read, delete")
  })

  it("replaces the defaults' list rather than adding to it", async () => {
    await runWith(["config", "set", "--defaults", "allow", "send,delete"])
    await runWith(["p-own", "config", "set", "allow", "reaction"])

    expect(resolveSettings({ profile: "p-own" }).allow).toEqual(["reaction"])
    expect(resolveSettings({ profile: "p-inherits" }).allow).toEqual(["send", "delete"])
    await runWith(["config", "unset", "--defaults", "allow"])
  })

  it("refuses what it does not allow with 5, never connects, names the fix, and journals the refusal", async () => {
    const { max, environment } = messenger()
    await runWith(["p-cmd", "config", "set", "allow", "reaction"])

    const refused = await runWith(["p-cmd", "messages", "send", "111", "hi", "--json"], environment)

    expect(refused.code).toBe(5)
    expect(max.sent).toEqual([])
    expect(JSON.parse(refused.stderr).error.message).toBe(
      "profile p-cmd does not allow send (allow: reaction — from the config file); " +
        "to allow it: max p-cmd config set allow reaction,send",
    )
    expect(new SendJournal(sendsPathFor("p-cmd")).entries()).toMatchObject([{ chatId: "111", outcome: "refused" }])

    expect((await runWith(["p-cmd", "reactions", "add", "111", "116762160362694583", "👍"], environment)).code).toBe(0)
  })

  it("points at --defaults when the list came from there", () => {
    const guard = sendGuard({
      profile: "p-def",
      readOnly: false,
      readOnlyFrom: "default",
      allow: ["send"],
      allowFrom: "config defaults",
      sendsPerHour: 10,
      journal: new SendJournal(sendsPathFor("p-def")),
      recipients: new RecipientList(recipientsPathFor("p-def")),
      warn: () => {},
    })
    expect(() => guard.check(null, "account", "sessions-end")).toThrow(
      "to allow it: max config set --defaults allow send,sessions",
    )
  })
})
