import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { captureStreams, memoryKeyring, resolvePaths } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const PHONE = "+71234567890"

const FOLDER = {
  id: "folder.personal",
  title: "Personal",
  include: [111],
  filters: [3],
  options: [1],
  sourceId: 7,
  updateTime: 1789776000000,
}

const account = (answers: Record<number, unknown> = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: {
          contact: {
            id: 10000001,
            phone: 71234567890,
            names: [{ firstName: "Test", lastName: "Person", name: "Test Person", type: "ONEME" }],
          },
        },
        chats: [
          { id: 111, title: "Friends", type: "CHAT" },
          { id: 222, title: "Work", type: "CHAT" },
        ],
      },
      [Opcode.CONTACT_INFO]: { contacts: [] },
      [Opcode.CONTACT_INFO_BY_PHONE]: { contact: { id: 20000002, names: [{ name: "Found Person" }] } },
      [Opcode.CONTACT_UPDATE]: { contact: { id: 20000002, names: [{ name: "Found Person" }] } },
      [Opcode.SYNC]: { phones: { [PHONE]: 20000002 }, contacts: [] },
      [Opcode.PROFILE]: {
        profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "ONEME" }], description: "hi" } },
      },
      [Opcode.FOLDERS_GET]: { folders: [FOLDER], foldersOrder: [FOLDER.id], folderSync: 1 },
      [Opcode.FOLDERS_UPDATE]: { folder: { ...FOLDER, title: "Renamed" }, folderSync: 2 },
      [Opcode.FOLDERS_DELETE]: { foldersOrder: [], folderSync: 3 },
      [Opcode.SESSIONS_INFO]: { sessions: [{ client: "WEB", current: true, info: "Chrome", time: 1789776000000 }] },
      [Opcode.SESSIONS_CLOSE]: {},
      ...answers,
    },
  })
  const keyring = memoryKeyring()
  const stores: SessionStore[] = []
  const environment: Environment = {
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      stores.push(store)
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    ask: async () => PHONE,
  }
  const sent = (opcode: number) => max.sent.filter((request) => request.opcode === opcode).map((one) => one.payload)
  return { max, environment, sent, stores }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run([...argv, "--json"], { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))

describe("contacts", () => {
  it("`lookup` asks for the number and never lets it reach stderr, the send journal or the run log", async () => {
    const { environment, sent } = account()
    const found = await runWith(["a-lookup", "contacts", "lookup", "--record"], environment)

    expect(found.code).toBe(0)
    expect(sent(Opcode.CONTACT_INFO_BY_PHONE)).toEqual([{ phone: PHONE }])
    expect(JSON.parse(found.stdout)).toMatchObject({ id: "20000002", name: "Found Person" })
    expect(found.stderr).not.toContain("1234567890")
    const state = resolvePaths({ appName: "max-cli", prefix: "MAX", env: process.env }).state
    for (const file of filesUnder(state)) expect(readFileSync(file, "utf8"), file).not.toContain("1234567890")
  })

  it("`lookup` refuses what is not a number without repeating it", async () => {
    const { environment, sent } = account()
    const refused = await runWith(["contacts", "lookup"], { ...environment, ask: async () => "call 555-mom" })

    expect(JSON.parse(refused.stderr).error.code).toBe("validation_error")
    expect(refused.stderr).not.toContain("555")
    expect(sent(Opcode.CONTACT_INFO_BY_PHONE)).toEqual([])
  })

  it("`add` and `remove` send CONTACT_UPDATE with the id and the action", async () => {
    const { environment, sent } = account()
    expect((await runWith(["contacts", "add", "20000002"], environment)).code).toBe(0)
    expect((await runWith(["contacts", "remove", "20000002"], environment)).code).toBe(0)

    expect(sent(Opcode.CONTACT_UPDATE).map((one) => ({ ...one, contactId: String(one.contactId) }))).toEqual([
      { contactId: "20000002", action: "ADD" },
      { contactId: "20000002", action: "REMOVE" },
    ])
  })

  it("`import` sends each line of the file as number and name, and reports what MAX recognised", async () => {
    const { environment, sent } = account()
    const file = join(process.env.TMPDIR ?? "/tmp", "phone-book.csv")
    writeFileSync(file, `${PHONE}, Found Person\n\n+7 (999) 000-33-44\tOther One\n`)

    const imported = await runWith(["a-import", "contacts", "import", file], environment)

    expect(imported.code).toBe(0)
    expect(sent(Opcode.SYNC)).toEqual([
      { contactList: { [PHONE]: { firstName: "Found Person" }, "+79990003344": { firstName: "Other One" } } },
    ])
    expect(JSON.parse(imported.stdout)).toEqual({ sent: 2, recognised: [PHONE], contacts: [] })
    expect(readFileSync(sendsPathFor("a-import"), "utf8")).not.toContain("1234567890")
  })

  it("`import` names a bad line by its number only", async () => {
    const { environment, sent } = account()
    const file = join(process.env.TMPDIR ?? "/tmp", "bad-book.csv")
    writeFileSync(file, `${PHONE}, Found Person\n${PHONE}\n`)

    const refused = await runWith(["contacts", "import", file], environment)

    expect(JSON.parse(refused.stderr).error.message).toBe('line 2 is not "number, name"')
    expect(sent(Opcode.SYNC)).toEqual([])
  })
})

describe("the profile", () => {
  it("`account update --description` sends the name the login carried along with it", async () => {
    const { environment, sent } = account()
    const updated = await runWith(["account", "update", "--description", "hi"], environment)

    expect(updated.code).toBe(0)
    expect(sent(Opcode.PROFILE)).toEqual([{ firstName: "Test", lastName: "Person", description: "hi" }])
    expect(JSON.parse(updated.stdout)).toMatchObject({ id: "10000001", description: "hi" })
  })

  it("a read-only profile refuses before anything is sent, and journals the refusal", async () => {
    const { environment, sent } = account()
    await runWith(["a-readonly", "config", "set", "readOnly", "true"])

    const refused = await runWith(["a-readonly", "account", "update", "--first-name", "X"], environment)

    expect(JSON.parse(refused.stderr).error.code).toBe("permission_error")
    expect(sent(Opcode.PROFILE)).toEqual([])
    expect(new SendJournal(sendsPathFor("a-readonly")).entries()).toMatchObject([
      { chatId: null, kind: "account", action: "profile", outcome: "refused" },
    ])
  })
})

describe("folders", () => {
  it("`update` sends the folder back whole, changing only the title, without what MAX keeps for itself", async () => {
    const { environment, sent } = account()
    const updated = await runWith(["chats", "folders", "update", "Personal", "--title", "Renamed"], environment)

    expect(updated.code).toBe(0)
    const [request] = sent(Opcode.FOLDERS_UPDATE)
    expect({ ...request, include: (request as { include: unknown[] }).include.map(String) }).toEqual({
      id: "folder.personal",
      title: "Renamed",
      include: ["111"],
      filters: [3],
      options: [1],
    })
  })

  it("`update --add` and `--remove` change the chats and keep the rest", async () => {
    const { environment, sent } = account()
    await runWith(["chats", "folders", "update", "folder.personal", "--add", "Work", "--remove", "111"], environment)

    expect((sent(Opcode.FOLDERS_UPDATE)[0] as { include: unknown[] }).include.map(String)).toEqual(["222"])
  })

  it("`create` sends a new id with the chats named, and `delete` sends the folder's id", async () => {
    const { environment, sent } = account()
    await runWith(["chats", "folders", "create", "New", "--chat", "Friends"], environment)
    await runWith(["chats", "folders", "delete", "Personal"], environment)

    const [created] = sent(Opcode.FOLDERS_UPDATE)
    expect(created?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect({ ...created, id: "", include: (created as { include: unknown[] }).include.map(String) }).toEqual({
      id: "",
      title: "New",
      include: ["111"],
      filters: [],
      options: [],
    })
    expect(sent(Opcode.FOLDERS_DELETE)).toEqual([{ folderIds: ["folder.personal"] }])
  })
})

describe("sessions", () => {
  it("`end-others` without --yes sends nothing", async () => {
    const { environment, sent } = account()
    const refused = await runWith(["account", "sessions", "end-others"], environment)

    expect(JSON.parse(refused.stderr).error.code).toBe("confirmation_required")
    expect(sent(Opcode.SESSIONS_CLOSE)).toEqual([])
  })

  it("`end-others --yes` keeps a token MAX hands back, prints none, and lists what is left", async () => {
    const { environment, sent, stores } = account({ [Opcode.SESSIONS_CLOSE]: { token: "a-new-token" } })
    const ended = await runWith(["account", "sessions", "end-others", "--yes"], environment)

    expect(ended.code).toBe(0)
    expect(sent(Opcode.SESSIONS_CLOSE)).toEqual([{}])
    expect(stores.at(-1)?.readToken()).toBe("a-new-token")
    expect(ended.stdout + ended.stderr).not.toContain("a-new-token")
    expect(JSON.parse(ended.stdout)).toEqual([
      { current: true, client: "WEB", device: "Chrome", location: null, lastActiveAt: "2026-09-19T00:00:00.000Z" },
    ])
  })

  it("`end-others --yes` says so plainly when MAX ended this session too", async () => {
    const max = account()
    const refusing = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: {}, [Opcode.SESSIONS_CLOSE]: {} },
      refuse: { [Opcode.SESSIONS_INFO]: "login.token" },
    })
    const ended = await runWith(["account", "sessions", "end-others", "--yes"], {
      ...max.environment,
      connection: () => new Connection({ createSocket: refusing.createSocket, timeoutMs: 50 }),
    })

    expect(JSON.parse(ended.stderr).error.message).toContain("run `max session start`")
  })
})
