import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/missing") return response.writeHead(404).end()
    response.writeHead(200, { "content-type": "application/octet-stream" }).end("file bytes")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const download = async (directory: string, { name = "report.pdf", path = "/file" } = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: { profile: { contact: { id: 10000001 } }, chats: [{ id: 111, title: "First", type: "CHAT" }] },
      [Opcode.CHAT_HISTORY]: {
        messages: [
          {
            id: 116762160362694583n,
            time: 1789776000000,
            sender: 10000001,
            text: "",
            attaches: [{ _type: "FILE", fileId: 42, name, size: 10 }, { _type: "CALL" }],
          },
        ],
      },
      [Opcode.FILE_DOWNLOAD]: { unsafe: false, url: `${origin}${path}` },
    },
  })
  const keyring = memoryKeyring()
  const streams = captureStreams()
  const code = await run(["messages", "download", "111", "116762160362694583", "--output", directory, "--json"], {
    streams,
    tty: false,
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  })
  return { code, max, stdout: streams.stdout.join(""), stderr: streams.stderr.join("") }
}

describe("max messages download", () => {
  it("asks MAX for the file's link and saves it under the file's own name", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "download-"))
    const { code, max, stdout, stderr } = await download(directory)

    expect(code).toBe(0)
    expect(max.unexpected).toEqual([])
    expect(String(max.sent.find((call) => call.opcode === Opcode.FILE_DOWNLOAD)?.payload.fileId)).toBe("42")
    expect(JSON.parse(stdout)).toEqual({ items: [{ kind: "file", path: join(directory, "report.pdf"), bytes: 10 }] })
    expect(stderr).toContain("not downloadable: call")
    expect(await readFile(join(directory, "report.pdf"), "utf8")).toBe("file bytes")
  })

  it("**never overwrites a file that is already there**, and leaves no partial file behind", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "download-"))
    await writeFile(join(directory, "report.pdf"), "mine")

    const { code, stdout, stderr } = await download(directory)

    expect(code).not.toBe(0)
    expect(stdout).toBe("")
    expect(stderr).toContain("already exists")
    expect(await readFile(join(directory, "report.pdf"), "utf8")).toBe("mine")
    expect(await readdir(directory)).toEqual(["report.pdf"])
  })

  it("keeps a name MAX sends inside the output directory", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "download-"))
    const { code } = await download(directory, { name: "./../escape.sh" })

    expect(code).toBe(0)
    expect(await readdir(directory)).toEqual(["escape.sh"])
  })

  it("fails when the link does not answer, and saves nothing", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "download-"))
    const { code, stderr } = await download(directory, { path: "/missing" })

    expect(code).not.toBe(0)
    expect(stderr).toContain("HTTP 404")
    expect(await readdir(directory)).toEqual([])
  })
})
