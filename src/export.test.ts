import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { openProfileCache } from "./cache/index.js"
import type { Environment } from "./commands/context.js"
import type { Message } from "./domain/models.js"
import { toMarkdown, unreadStretches } from "./export.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"

const at = (iso: string) => Date.parse(iso)

const message = (id: string, timestamp: string, text: string, over: Partial<Message> = {}): Message => ({
  id,
  chatId: "111",
  senderId: "7",
  senderName: "Анна",
  timestamp,
  editedAt: null,
  text,
  outgoing: false,
  attachments: [],
  replyTo: null,
  forwardedFrom: null,
  reactions: null,
  ...over,
})

describe("what an export cannot contain", () => {
  it("merges pages that overlap by one message, and names the stretch between two that do not", () => {
    const ranges = [
      { from: at("2026-09-01T10:00:00Z"), to: at("2026-09-01T12:00:00Z") },
      { from: at("2026-09-01T12:00:00Z"), to: at("2026-09-01T14:00:00Z") },
      { from: at("2026-09-03T10:00:00Z"), to: at("2026-09-03T11:00:00Z") },
    ]

    expect(unreadStretches(ranges)).toEqual([
      { from: null, to: "2026-09-01T10:00:00.000Z" },
      { from: "2026-09-01T14:00:00.000Z", to: "2026-09-03T10:00:00.000Z" },
    ])
  })

  it("starts at --since, and reaches the chat's last message when that is newer than what was read", () => {
    const ranges = [{ from: at("2026-09-02T00:00:00Z"), to: at("2026-09-02T01:00:00Z") }]

    expect(unreadStretches(ranges, { since: at("2026-09-01T00:00:00Z"), last: at("2026-09-05T00:00:00Z") })).toEqual([
      { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" },
      { from: "2026-09-02T01:00:00.000Z", to: "2026-09-05T00:00:00.000Z" },
    ])
  })
})

describe("the Markdown export", () => {
  it("heads each day, quotes replies and forwards, and links what can be linked", () => {
    const quoted = { ...message("1", "2026-09-01T09:00:00Z", "где встречаемся?"), senderName: "Борис" }
    const markdown = toMarkdown(
      "Друзья",
      [
        message("2", "2026-09-01T09:05:00Z", "у входа", { replyTo: quoted, editedAt: "2026-09-01T09:06:00Z" }),
        message("3", "2026-09-02T18:30:00Z", "", {
          attachments: [
            { kind: "photo", url: "https://i.example/p.jpg" },
            { kind: "file", name: "план.pdf", fileId: "9" },
          ],
          forwardedFrom: { ...quoted, text: "первая строка\nвторая" },
        }),
      ],
      "UTC",
    )

    expect(markdown).toBe(
      [
        "# Друзья",
        "",
        "## 2026-09-01",
        "",
        "**09:05 Анна** · edited",
        "> **Борис:** где встречаемся?",
        "у входа",
        "",
        "## 2026-09-02",
        "",
        "**18:30 Анна**",
        "> forwarded from **Борис**",
        "> первая строка",
        "> вторая",
        "- [photo](https://i.example/p.jpg)",
        "- file: план.pdf",
        "",
      ].join("\n"),
    )
  })
})

describe("the Markdown export of text other people wrote", () => {
  it("shows control characters instead of sending them to the terminal, and keeps the names on one line", () => {
    const markdown = toMarkdown("Друзья\n# fake", [
      message("1", "2026-09-01T09:00:00Z", "a\u001b[2Kb\nвторая", { senderName: "Анна\n**09:00 вы**" }),
    ])
    expect(markdown).not.toContain("\u001b")
    expect(markdown).toContain("a\\x1b[2Kb\nвторая")
    expect(markdown).toContain("# Друзья\\x0a# fake\n")
    expect(markdown).toContain("Анна\\x0a**09:00 вы**")
  })

  it("links only web addresses", () => {
    const markdown = toMarkdown("Друзья", [
      message("1", "2026-09-01T09:00:00Z", "", {
        attachments: [
          { kind: "file", name: "a.pdf", url: "javascript:alert(1)" },
          { kind: "photo", url: "http://i.example/p.jpg" },
        ],
      }),
    ])
    expect(markdown).not.toContain("javascript:")
    expect(markdown).toContain("- file: a.pdf")
    expect(markdown).toContain("- [photo](http://i.example/p.jpg)")
  })
})

describe("max export messages", () => {
  const prepared = async (profile: string) => {
    const cache = await openProfileCache(profile)
    if (!cache) throw new Error("no cache in the test sandbox")
    cache.chats.write([
      {
        id: "111",
        title: "Друзья",
        kind: "group",
        unreadCount: 0,
        lastMessageAt: "2026-09-05T00:00:00.000Z",
        participantsCount: 3,
      },
    ])
    cache.messages.write("111", [message("1", "2026-09-01T10:00:00.000Z", "раз")])
    cache.messages.write("111", [message("2", "2026-09-03T10:00:00.000Z", "два")])
    cache.close()

    let connected = false
    const environment: Environment = {
      store: (name) => new SessionStore({ profile: name, keyring: memoryKeyring() }),
      connection: () =>
        new Connection({
          createSocket: () => {
            connected = true
            throw new Error("export must not connect")
          },
        }),
    }
    return { environment, connected: () => connected }
  }

  const runWith = async (argv: string[], environment: Environment) => {
    const streams = captureStreams()
    const code = await run(argv, { ...environment, streams })
    return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
  }

  it("writes the same objects `messages list --jsonl` answers, readable by the owner only, and never connects", async () => {
    const { environment, connected } = await prepared("x-export")
    const file = join(process.env.TMPDIR ?? "", "export", "chat.jsonl")

    const exported = await runWith(
      ["x-export", "--json", "export", "messages", "Друзья", "--format", "jsonl", "--output", file],
      environment,
    )
    const listed = await runWith(["x-export", "--offline", "--jsonl", "messages", "list", "111"], environment)

    expect(exported.code).toBe(0)
    expect(readFileSync(file, "utf8")).toBe(`${listed.stdout}\n`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(exported.stdout)).toMatchObject({ count: 2, unread: [{ from: null }, {}, {}] })
    expect(connected()).toBe(false)
  })

  it("says on stderr what the cache never read, and keeps stdout for the export itself", async () => {
    const { environment } = await prepared("x-export-md")

    const { code, stdout, stderr } = await runWith(
      ["x-export-md", "export", "messages", "111", "--format", "md"],
      environment,
    )

    expect(code).toBe(0)
    expect(stdout).toMatch(/^# Друзья\n/)
    expect(stderr).toContain("anything before 2026-09-01T10:00:00.000Z, never read")
    expect(stderr).toContain("2026-09-01T10:00:00.000Z to 2026-09-03T10:00:00.000Z, never read")
    expect(stderr).toContain("2026-09-03T10:00:00.000Z to 2026-09-05T00:00:00.000Z, never read")
    expect(stderr).toContain("--before 1")
  })
})
