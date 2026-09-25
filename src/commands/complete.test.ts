import { existsSync } from "node:fs"
import { captureStreams } from "@leemour/cli-core"
import { beforeAll, describe, expect, it } from "vitest"
import { openProfileCache, profileCacheFile } from "../cache/index.js"
import { run } from "../program.js"

const complete = async (...words: string[]) => {
  const streams = captureStreams()
  const code = await run(["complete", "--", ...words], { streams })
  return { code, lines: streams.stdout.join("\n").split("\n"), stderr: streams.stderr }
}

const values = (lines: string[]) => lines.filter((line) => !line.startsWith(":")).map((line) => line.split("\t")[0])

beforeAll(async () => {
  const store = await openProfileCache("tabbed")
  store?.chats.write([
    { id: "101", title: "Family", kind: "group", unreadCount: 0, lastMessageAt: null, participantsCount: 3 },
    { id: "102", title: "Work chat", kind: "group", unreadCount: 0, lastMessageAt: null, participantsCount: 5 },
    { id: "103", title: "Evil\u001b[2K", kind: "group", unreadCount: 0, lastMessageAt: null, participantsCount: 2 },
    { id: "104", title: "$(touch x)", kind: "group", unreadCount: 0, lastMessageAt: null, participantsCount: 2 },
    { id: "105", title: "ok\n$(touch y)", kind: "group", unreadCount: 0, lastMessageAt: null, participantsCount: 2 },
  ])
  store?.people.upsert(
    [
      { id: "7", name: "Иван Петров", username: "ivan", description: null, lastMessagedAt: null },
      { id: "8", name: "Eve\n$(touch z)", username: "$(touch w)", description: null, lastMessagedAt: null },
    ],
    "login",
  )
  store?.close()
})

describe("max complete", () => {
  it("offers the commands, not the hidden one, and ends with the directive", async () => {
    const { code, lines, stderr } = await complete("")
    expect(code).toBe(0)
    expect(values(lines)).toContain("chats")
    expect(values(lines)).not.toContain("complete")
    expect(lines.at(-1)).toBe(":4")
    expect(stderr).toEqual([])
  })

  it("completes a half-typed first word as a command, not as a profile", async () => {
    const { lines } = await complete("mess")
    expect(values(lines)).toEqual(["messages"])
  })

  it("offers chat ids with their titles beside them, never a title as the word", async () => {
    const { lines } = await complete("tabbed", "messages", "list", "")
    expect(lines).toContain("101\tFamily")
    expect(lines).toContain("102\tWork chat")
    expect(values(lines)).toEqual(["101", "102", "103", "104", "105"])
  })

  it("shows a title's control characters instead of passing them to the shell", async () => {
    const { lines } = await complete("tabbed", "messages", "list", "")
    expect(lines).toContain("103\tEvil\\x1b[2K")
    expect(lines.join("\n")).not.toContain("\u001b")
  })

  it("gives bash no word a title or a name could run code from", async () => {
    const chats = await complete("tabbed", "messages", "list", "")
    const people = await complete("tabbed", "contacts", "show", "")

    expect(chats.lines).toContain("105\tok\\x0a$(touch y)")
    for (const { lines } of [chats, people]) {
      expect(values(lines).every((word) => /^\d+$/.test(word ?? ""))).toBe(true)
    }
    expect(people.lines).toContain("8\tEve\\x0a$(touch z)")
  })

  it("offers nothing for a chat when this profile has no cache, and creates none", async () => {
    const { code, lines } = await complete("nocache", "messages", "list", "")
    expect(code).toBe(0)
    expect(lines).toEqual([":4"])
    expect(existsSync(profileCacheFile("nocache"))).toBe(false)
  })

  it("refuses a shell it does not know, on stderr", async () => {
    const streams = captureStreams()
    expect(await run(["complete", "tcsh"], { streams })).toBe(2)
    expect(streams.stdout).toEqual([])
    expect(streams.stderr.join("")).toContain("zsh")
  })
})
