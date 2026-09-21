import { captureStreams, createRenderer } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { resolveSettings, type Settings } from "../config.js"
import { renderPage, window } from "./paging.js"

const settingsWith = (over: Partial<Settings>): Settings => ({ ...resolveSettings({}, { env: {} }), ...over })

const rendered = (format: "json" | "pretty", over: Partial<Settings>, hasMore: boolean) => {
  const streams = captureStreams()
  const renderer = createRenderer({ format, color: false, streams })
  renderPage({ renderer, format, settings: settingsWith(over) }, { items: [{ id: "1" }, { id: "2" }], hasMore })
  return { stdout: streams.stdout.join(""), stderr: streams.stderr.join("") }
}

describe("what a paged command answers", () => {
  it("**one object in machine mode**, always the same four fields", () => {
    const { stdout, stderr } = rendered("json", { limit: 2, page: 1 }, true)

    expect(JSON.parse(stdout)).toEqual({ items: [{ id: "1" }, { id: "2" }], page: 1, limit: 2, hasMore: true })
    expect(stderr).toBe("")
  })

  it("says there is no more on the last page", () => {
    expect(JSON.parse(rendered("json", { limit: 2, page: 2 }, false).stdout)).toMatchObject({ page: 2, hasMore: false })
  })

  it("**`--all` answers the same shape**, so no caller has to branch on which one it got", () => {
    expect(JSON.parse(rendered("json", { all: true }, true).stdout)).toEqual({
      items: [{ id: "1" }, { id: "2" }],
      page: 1,
      limit: 2,
      hasMore: false,
    })
  })

  it("**gives a person the table, and puts the page line on stderr**", () => {
    const { stdout, stderr } = rendered("pretty", { limit: 2, page: 1 }, true)

    expect(stdout).not.toContain("hasMore")
    expect(stderr).toContain("--page 2")
  })

  it("says nothing about pages when there are none left", () => {
    expect(rendered("pretty", { limit: 2, page: 1 }, false).stderr).toBe("")
  })
})

describe("which rows to ask for", () => {
  it("turns a page number into an offset", () => {
    expect(window(settingsWith({ limit: 20, page: 3 }))).toEqual({ limit: 20, offset: 40 })
  })

  it("asks for everything, from the start, under `--all`", () => {
    expect(window(settingsWith({ all: true, limit: 20, page: 1 }))).toEqual({ offset: 0 })
  })
})
