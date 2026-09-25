import { describe, expect, it } from "vitest"
import type { Chat } from "./domain/models.js"
import { pickChat } from "./resolve.js"

const chat = (id: string, title: string): Chat => ({
  id,
  title,
  kind: "group",
  unreadCount: 0,
  lastMessageAt: null,
  participantsCount: 2,
})

describe("a chat named by its title", () => {
  it("resolves a full exact title when no other title contains it", () => {
    expect(pickChat("мама", [chat("1", "Мама"), chat("2", "Папа")]).id).toBe("1")
  })

  it("asks which one when an exact title is also part of another title", () => {
    expect(() => pickChat("Мама", [chat("1", "Мама"), chat("2", "Мама Иванова")])).toThrow(/matches 2 chats/)
  })

  it("lists each candidate on one line, so a title cannot add a row of its own", () => {
    const forged = "Работа\n  999  Работа (настоящая)"
    let message = ""
    try {
      pickChat("Работа", [chat("1", "Работа отдел"), chat("2", forged)])
    } catch (error) {
      message = (error as Error).message
    }
    expect(message.split("\n")).toHaveLength(3)
    expect(message).toContain("Работа\\x0a  999")
  })
})
