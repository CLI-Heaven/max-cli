import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError, captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { MaxClient } from "../client.js"
import { Opcode } from "../generated/opcodes.generated.js"
import { Connection } from "../protocol/connection.js"
import { SessionStore } from "../session/store.js"
import { mockMax } from "../testing/mock-max.js"
import { type DiagnosticEvent, maxErrorKey, renderEvent } from "./events.js"
import { crashOf, recorded } from "./recording.js"
import { listRuns, readEvents } from "./run.js"

const REQUEST: DiagnosticEvent = { event: "request", operation: "chats.history", opcode: 49, seq: 3 }

const recordRun = async (
  options: { record?: boolean; keepFailed?: boolean },
  body: (events: (event: DiagnosticEvent) => void) => Promise<void>,
) => {
  const runsDir = join(mkdtempSync(join(tmpdir(), "max-run-log-")), "runs")
  const failure = await recorded(
    { command: "chats list", profile: "default", options, format: "json", streams: captureStreams(), runsDir },
    body,
  ).catch((error: unknown) => error)
  const runs = listRuns(runsDir)
  const dir = runs[0] ? join(runsDir, runs[0].startedAt.slice(0, 10), runs[0].runId) : undefined
  return {
    runs,
    failure,
    events: dir ? readEvents(dir) : [],
    raw: dir ? readFileSync(join(dir, "events.jsonl"), "utf8") : "",
  }
}

describe("MAX's refusal, as a key", () => {
  it("keeps a dotted key and drops anything that reads as a sentence", () => {
    expect(maxErrorKey("login.token")).toBe("login.token")
    expect(maxErrorKey("folder.validation.title.too-long")).toBe("folder.validation.title.too-long")
    expect(maxErrorKey("chat 111: Привет")).toBeUndefined()
    expect(maxErrorKey("Слишком много попыток")).toBeUndefined()
    expect(maxErrorKey(42)).toBeUndefined()
  })

  it("reaches the response event, and not when MAX answered with a sentence", async () => {
    const answers = { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { profile: { contact: { id: 10000001 } }, chats: [] } }
    const run = async (refusal: string) => {
      const max = mockMax({ answers, refuse: { [Opcode.CHAT_HISTORY]: refusal } })
      const dir = mkdtempSync(join(tmpdir(), "max-run-log-"))
      const store = new SessionStore({ keyring: memoryKeyring(), configDir: dir, stateDir: join(dir, "s"), env: {} })
      store.writeToken("a-token")
      const events: DiagnosticEvent[] = []
      const client = new MaxClient({
        store,
        connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
        warn: () => {},
        events: (event) => events.push(event),
      })
      const error = await client.messages.list("111").catch((failure: unknown) => failure)
      await client.close()
      return { error, response: events.find((event) => event.event === "response" && event.outcome === "error") }
    }

    const keyed = await run("proto.payload")
    const worded = await run("you sent: Привет, как дела")

    expect(keyed.response).toMatchObject({ errorCode: "provider_error", maxError: "proto.payload" })
    expect((keyed.error as CliError).details.maxError).toBe("proto.payload")
    expect(worded.response).not.toHaveProperty("maxError")
  })
})

describe("a failed run", () => {
  it("is kept without --record, with every event before the failure and the key MAX gave", async () => {
    const { runs, events } = await recordRun({ keepFailed: true }, async (emit) => {
      emit(REQUEST)
      throw new CliError("provider_error", "MAX refused opcode 49: proto.payload", { maxError: "proto.payload" })
    })

    expect(runs).toMatchObject([
      { status: "failed", errorCode: "provider_error", maxError: "proto.payload", keptBecauseFailed: true },
    ])
    expect(runs[0]).toMatchObject({ runtime: expect.stringMatching(/^(node|bun) /), platform: process.platform })
    expect(events).toMatchObject([{ event: "request", operation: "chats.history" }])
  })

  it("leaves nothing when it succeeds, or when recording was turned off by name", async () => {
    expect((await recordRun({ keepFailed: true }, async (emit) => emit(REQUEST))).runs).toEqual([])
    const off = await recordRun({ keepFailed: false }, async () => {
      throw new CliError("provider_error", "no")
    })
    expect(off.runs).toEqual([])
  })

  it("records where a crash happened, never what it said", async () => {
    const { runs, events, raw } = await recordRun({ keepFailed: true }, async () => {
      throw new TypeError("cannot read the message «Привет, это секрет»")
    })

    expect(runs[0]).toMatchObject({ errorCode: "generic_failure" })
    expect(events.at(-1)).toMatchObject({ event: "crash", errorName: "TypeError", frames: expect.any(Array) })
    expect(raw).not.toContain("секрет")
  })
})

describe("a crash's frames", () => {
  it("keep the function and the file inside the package, not the path to it", () => {
    const error = new Error("x")
    error.stack = [
      "Error: x",
      "    at MaxClient.connect (/home/someone/.local/share/pnpm/global/node_modules/@leemour/max-cli/dist/client.js:1497:13)",
      "    at async /home/someone/project/src/commands/chats.ts:40:5",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
    ].join("\n")

    expect(crashOf(error).frames).toEqual([
      "MaxClient.connect client.js:1497",
      "<anonymous> commands/chats.ts:40",
      "process.processTicksAndRejections task_queues:105",
    ])
  })
})

describe("a warning", () => {
  it("reaches the run as a code when the client goes on without something", async () => {
    const max = mockMax({
      answers: {
        [Opcode.SESSION_INIT]: {},
        [Opcode.LOGIN]: { profile: { contact: { id: 10000001 } }, chats: [] },
        [Opcode.CONTACT_INFO]: { contacts: [] },
        [Opcode.CHAT_HISTORY]: {
          messages: [{ id: 116762160362694583n, time: 1789776000000, sender: 10000001, text: "hi" }],
        },
      },
      refuse: { [Opcode.MSG_GET_REACTIONS]: "proto.payload" },
    })
    const dir = mkdtempSync(join(tmpdir(), "max-run-log-"))
    const store = new SessionStore({ keyring: memoryKeyring(), configDir: dir, stateDir: join(dir, "s"), env: {} })
    store.writeToken("a-token")
    const events: DiagnosticEvent[] = []
    const client = new MaxClient({
      store,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      warn: () => {},
      events: (event) => events.push(event),
    })

    await client.messages.list("111")
    await client.close()

    expect(events.filter((event) => event.event === "warning")).toEqual([
      { event: "warning", code: "reactions_unread" },
    ])
  })

  it("is shown with its code, and never needs the sentence", () => {
    expect(renderEvent({ event: "warning", code: "reactions_unread" })).toContain("reactions_unread")
    expect(
      renderEvent({ event: "warning", code: "response_shape", operation: "chats.history", detail: "x: number" }),
    ).toMatch(/^! chats\.history +response_shape {2}x: number$/)
  })
})
