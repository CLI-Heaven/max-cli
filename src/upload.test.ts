import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
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
let directory: string

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume()
    request.on("end", () => {
      if (request.url === "/broken") return response.writeHead(500).end()
      if (request.url === "/photo") return response.end(JSON.stringify({ photos: { a: { token: "photo-token" } } }))
      response.end("0")
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "upload-"))
  await writeFile(join(directory, "picture.png"), "not really a png")
  await writeFile(join(directory, "report.txt"), "a report")
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const send = async (argv: string[], { fileUrl = "/file" } = {}) => {
  let refusals = 1
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: { profile: { contact: { id: 10000001 } }, chats: [{ id: 0, type: "DIALOG" }] },
      [Opcode.PHOTO_UPLOAD]: { url: `${origin}/photo` },
      [Opcode.FILE_UPLOAD]: { info: [{ url: `${origin}${fileUrl}`, fileId: 42, token: "t" }] },
      [Opcode.MSG_SEND]: { message: { id: 116762160362694590n, time: 1789776000000, sender: 10000001, text: "" } },
    },
    refuse: { [Opcode.MSG_SEND]: () => (refusals-- > 0 ? "attachment.not.ready" : undefined) },
  })
  const keyring = memoryKeyring()
  const streams = captureStreams()
  const code = await run(["messages", "send", "0", ...argv, "--json"], {
    streams,
    tty: false,
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  })
  const sends = max.sent.filter((call) => call.opcode === Opcode.MSG_SEND).map((call) => call.payload)
  return { code, sends, stderr: streams.stderr.join("") }
}

describe("sending files", () => {
  it("uploads a file, and sends again with the same cid while it is not ready", async () => {
    const { code, sends } = await send(["--file", join(directory, "report.txt")])

    expect(code).toBe(0)
    expect(sends).toHaveLength(2)
    const [first, second] = sends as { message: { cid: unknown; text: string; attaches: { fileId?: unknown }[] } }[]
    expect(second?.message.cid).toBe(first?.message.cid)
    expect(second?.message.text).toBe("")
    expect(second?.message.attaches[0]).toMatchObject({ _type: "FILE" })
    expect(String(second?.message.attaches[0]?.fileId)).toBe("42")
  })

  it("sends two photos in one message", async () => {
    const photo = join(directory, "picture.png")
    const { code, sends } = await send(["--file", photo, "--file", photo])

    expect(code).toBe(0)
    expect((sends.at(-1) as { message: { attaches: unknown[] } }).message.attaches).toEqual([
      { _type: "PHOTO", photoToken: "photo-token" },
      { _type: "PHOTO", photoToken: "photo-token" },
    ])
  })

  it("**refuses a file beside another attachment before uploading anything**", async () => {
    const { code, sends, stderr } = await send([
      "--file",
      join(directory, "picture.png"),
      "--file",
      join(directory, "report.txt"),
    ])

    expect(code).not.toBe(0)
    expect(sends).toEqual([])
    expect(stderr).toContain("a message of its own")
  })

  it("**sends nothing when an upload fails**", async () => {
    const { code, sends, stderr } = await send(["--file", join(directory, "report.txt")], { fileUrl: "/broken" })

    expect(code).not.toBe(0)
    expect(sends).toEqual([])
    expect(stderr).toContain("nothing was sent")
  })

  it("refuses a key from a hidden folder and max's own files, unless told any file may go", async () => {
    await mkdir(join(directory, ".ssh"), { recursive: true })
    await writeFile(join(directory, ".ssh", "id_ed25519"), "a private key")
    const state = process.env.MAX_STATE_DIR ?? ""
    await mkdir(state, { recursive: true })
    await writeFile(join(state, "kept.json"), "{}")

    for (const path of [join(directory, ".ssh", "id_ed25519"), join(state, "kept.json")]) {
      const { code, sends, stderr } = await send(["--file", path])
      expect(code).not.toBe(0)
      expect(sends).toEqual([])
      expect(stderr).toContain("--allow-any-file")
    }

    const { code } = await send(["--file", join(directory, ".ssh", "id_ed25519"), "--allow-any-file"])
    expect(code).toBe(0)
  })

  // Windows needs a privilege to make a link.
  it.skipIf(process.platform === "win32")("refuses a link that points into a hidden folder", async () => {
    await mkdir(join(directory, ".ssh"), { recursive: true })
    await writeFile(join(directory, ".ssh", "id_rsa"), "a private key")
    await symlink(join(directory, ".ssh", "id_rsa"), join(directory, "notes.txt"))

    const { code, sends } = await send(["--file", join(directory, "notes.txt")])
    expect(code).not.toBe(0)
    expect(sends).toEqual([])
  })

  it("refuses a file that is not there before connecting", async () => {
    const { code, sends, stderr } = await send(["--file", join(directory, "missing.pdf")])

    expect(code).not.toBe(0)
    expect(sends).toEqual([])
    expect(stderr).toContain("no such file")
  })
})
