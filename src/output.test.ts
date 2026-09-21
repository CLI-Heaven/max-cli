import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { MaxClient } from "./client.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { resolveOutput } from "./output.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const loginAnswer = {
  profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
  chats: [{ id: 111, title: "First", type: "CHAT", lastEventTime: 1789776000000 }],
}

/**
 * The protocol note, from where it is raised to where it lands — the path `BUG-7` was about.
 *
 * Asserting on the renderer alone would not have caught it: the note was routed past the renderer
 * altogether, straight to stderr, and every renderer test passed while `--quiet` printed.
 */
const readingAChatThatAnswersOddly = async (options: { quiet?: boolean; json?: boolean }) => {
  const streams = captureStreams()
  const { renderer } = resolveOutput({ ...options, streams, tty: false })

  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: loginAnswer,
      [Opcode.CHAT_HISTORY]: { messages: "not a list of messages" },
    },
  })

  const dir = mkdtempSync(join(tmpdir(), "max-output-"))
  const store = new SessionStore({ keyring: memoryKeyring(), configDir: dir, stateDir: join(dir, "state"), env: {} })
  store.writeToken("a-token")

  const client = new MaxClient({
    store,
    connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
    warn: renderer.note,
  })

  try {
    await client.connect()
    renderer.result(await client.messages.list("111", 5))
  } finally {
    await client.close()
  }

  return streams
}

describe("--quiet", () => {
  it("**silences the protocol note too**, which it did not before (`BUG-7`)", async () => {
    const streams = await readingAChatThatAnswersOddly({ quiet: true })
    expect(streams.stderr).toEqual([])
  })

  it("still prints the result — it is diagnostics that go quiet, not the answer", async () => {
    const streams = await readingAChatThatAnswersOddly({ quiet: true })
    expect(streams.stdout.join("")).toBe("[]")
  })
})

describe("without --quiet", () => {
  it("says once that MAX answered with something we did not declare", async () => {
    const streams = await readingAChatThatAnswersOddly({})
    expect(streams.stderr.join("")).toContain("chats.history")
  })

  it("**keeps the note off stdout in machine mode**, so one JSON value is all a script reads", async () => {
    const streams = await readingAChatThatAnswersOddly({ json: true })
    expect(streams.stderr.join("")).toContain("chats.history")
    expect(JSON.parse(streams.stdout.join(""))).toEqual([])
  })
})
