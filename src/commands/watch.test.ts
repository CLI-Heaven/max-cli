import { describe, expect, it } from "vitest"
import type { MessageHit } from "../domain/models.js"
import { watchLine } from "./watch.js"

const message = { id: "1", chatId: "111", text: "hi", chatTitle: "First" } as MessageHit
const edit = { event: "change", change: { event: "edit", message: { ...message, text: "hi!" } } } as const
const plain = { events: false, pretty: false, render: () => "" }

describe("max watch lines", () => {
  it("without --events: bare messages as before, and no line for a change", () => {
    expect(JSON.parse(watchLine({ event: "message", message }, plain) ?? "")).toEqual(message)
    expect(watchLine(edit, plain)).toBeUndefined()
  })

  it("with --events: every line names its event", () => {
    const events = { ...plain, events: true }
    expect(JSON.parse(watchLine({ event: "message", message }, events) ?? "")).toEqual({ event: "message", message })
    expect(JSON.parse(watchLine(edit, events) ?? "")).toMatchObject({ event: "edit", message: { text: "hi!" } })
  })
})
