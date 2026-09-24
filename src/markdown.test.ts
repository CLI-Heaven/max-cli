import { describe, expect, it } from "vitest"
import { parseMarkdown } from "./markdown.js"

describe("parseMarkdown", () => {
  it("strips the marks and places each span on the text that is sent", () => {
    expect(parseMarkdown("a **b** _c_ ~~d~~ `e`")).toEqual({
      text: "a b c d e",
      markup: [
        { type: "STRONG", from: 2, length: 1 },
        { type: "EMPHASIZED", from: 4, length: 1 },
        { type: "STRIKETHROUGH", from: 6, length: 1 },
        { type: "MONOSPACED", from: 8, length: 1 },
      ],
    })
  })

  it("counts positions the way MAX does, in UTF-16, so an emoji before a mark does not shift it", () => {
    expect(parseMarkdown("👍 **ok**").markup).toEqual([{ type: "STRONG", from: 3, length: 2 }])
  })

  it("**leaves snake_case, arithmetic and an unclosed mark as typed**", () => {
    for (const text of ["file_name_here", "2*3*4", "a ** b", "**open", "_a\nb_"]) {
      expect(parseMarkdown(text)).toEqual({ text, markup: [] })
    }
  })

  it("keeps a backslashed mark literal", () => {
    expect(parseMarkdown("\\*not\\*")).toEqual({ text: "*not*", markup: [] })
  })
})
