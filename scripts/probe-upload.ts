/**
 * How are a photo, a file and a voice message uploaded and sent? Run by hand, never by CI.
 *
 *   pnpm probe:upload <photo.png> <file.txt> <voice.ogg>
 *
 * **Sends to the Saved-messages dialog (chat 0) and nowhere else** (`NEED-28`, `NEED-150`). The
 * shapes are PyMax's (`src/pymax/api/uploads/`); this turns them into a measurement. Printed: field
 * names, HTTP statuses, MAX's error codes, the opcodes MAX pushes. Never file contents.
 */
import { readFileSync, statSync } from "node:fs"
import { basename } from "node:path"
import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const [photoPath, filePath, voicePath] = process.argv.slice(2)
if (!photoPath || !filePath || !voicePath) {
  console.error("usage: pnpm probe:upload <photo.png> <file.txt> <voice.ogg>")
  process.exit(2)
}

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
const token = store.readToken()
if (!token) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

type Json = Record<string, unknown>
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {}
const keys = (value: unknown) => Object.keys(record(value)).sort().join(",")

const pushes: { opcode: number; payload: Json }[] = []
const connection = new Connection({
  timeoutMs: 20_000,
  onEvent: (frame) => {
    pushes.push({ opcode: frame.opcode, payload: record(frame.payload) })
    console.log(`  push: opcode ${frame.opcode} keys=${keys(frame.payload)}`)
  },
})
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))
const headers = {
  "User-Agent": WEB_USER_AGENT.headerUserAgent,
  Referer: "https://web.max.ru/",
  Origin: "https://web.max.ru",
}

const waitForPush = async (opcode: number, match: (payload: Json) => boolean, ms: number) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const found = pushes.find((push) => push.opcode === opcode && match(push.payload))
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return undefined
}

let cid = Date.now()
const sent: string[] = []
const send = async (label: string, attach: Json) => {
  cid += 1
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const answer = await connection.invoke(64, {
        chatId: 0,
        message: { text: `max-cli upload probe: ${label}`, cid, elements: [], attaches: [attach] },
        notify: true,
      })
      const id = asId(record(answer.message).id)
      console.log(`  sent ${label}: message ${id} (attempt ${attempt})`)
      if (id) sent.push(id)
      return
    } catch (error) {
      const reason = String(record((error as { payload?: unknown }).payload).error ?? (error as Error).message)
      console.log(`  send ${label} attempt ${attempt} refused: ${reason}`)
      if (reason !== "attachment.not.ready") return
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

const rawUpload = async (url: string, path: string, range: string) => {
  const size = statSync(path).size
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Disposition": `attachment; filename=${encodeURIComponent(basename(path))}`,
      "Content-Range": range.replace("{end}", String(size - 1)).replace("{size}", String(size)),
      "Content-Type": "application/octet-stream",
    },
    body: readFileSync(path),
  })
  const text = await response.text()
  const masked = text.replace(/"[^"]{24,}"/g, '"<long>"')
  console.log(`  upload HTTP ${response.status}, body ${text.length} bytes: ${masked.slice(0, 200)}`)
}

try {
  await connection.open()
  await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 1 })

  const only = process.env.ONLY
  if (!only || only === "photo") {
    console.log("photo (80):")
    const photo = await connection.invoke(80, { count: 1, type: 0, uploaderType: 0, profile: false })
    console.log(`  answer keys=${keys(photo)}`)
    const form = new FormData()
    form.append("file", new Blob([readFileSync(photoPath)], { type: "image/png" }), "image.png")
    const photoResponse = await fetch(String(photo.url), { method: "POST", headers, body: form })
    const photoJson = record(await photoResponse.json().catch(() => ({})))
    const photoEntry = record(Object.values(record(photoJson.photos))[0])
    console.log(`  upload HTTP ${photoResponse.status}, json keys=${keys(photoJson)}, entry keys=${keys(photoEntry)}`)
    if (typeof photoEntry.token === "string") await send("photo", { _type: "PHOTO", photoToken: photoEntry.token })
  }
  if (!only || only === "file") {
    console.log("file (87):")
    const file = await connection.invoke(87, { count: 1, type: 0, uploaderType: 0, profile: false })
    const fileInfo = record((Array.isArray(file.info) ? file.info : [])[0])
    console.log(`  answer keys=${keys(file)}, info keys=${keys(fileInfo)}`)
    await rawUpload(String(fileInfo.url), filePath, "0-{end}/{size}")
    const filePush = await waitForPush(136, (payload) => asId(payload.fileId) === asId(fileInfo.fileId), 30_000)
    console.log(`  processed push: ${filePush ? `yes, keys=${keys(filePush.payload)}` : "none within 30s"}`)
    await send("file", { _type: "FILE", fileId: fileInfo.fileId })
  }
  if (!only || only === "voice") {
    console.log("voice (82):")
    const voice = await connection.invoke(82, { count: 1, type: 2, uploaderType: 1, profile: false })
    const voiceInfo = record((Array.isArray(voice.info) ? voice.info : [])[0])
    console.log(`  answer keys=${keys(voice)}, info keys=${keys(voiceInfo)}`)
    await rawUpload(String(voiceInfo.url), voicePath, "bytes 0-{end}/{size}")
    const voicePush = await waitForPush(
      136,
      (payload) => asId(payload.audioId ?? payload.videoId) === asId(voiceInfo.videoId),
      15_000,
    )
    console.log(`  processed push: ${voicePush ? `yes, keys=${keys(voicePush.payload)}` : "none within 15s"}`)
    await send("voice", { _type: "AUDIO", audioId: voiceInfo.videoId, token: voiceInfo.token, duration: 2000 })
  }

  const history = await connection.invoke(
    chatsHistory.opcode,
    buildRequest(chatsHistory, {
      chatId: "0",
      from: Date.now() + 60_000,
      forward: 0,
      backward: 10,
      forwardTime: 0,
      backwardTime: 0,
      itemType: "REGULAR",
      getChat: false,
      getMessages: true,
    }),
  )
  console.log("\nread back:")
  for (const message of (Array.isArray(history.messages) ? history.messages : []).map(record)) {
    if (!sent.includes(asId(message.id) ?? "")) continue
    for (const attach of Array.isArray(message.attaches) ? message.attaches : [])
      console.log(`  ${record(attach)._type}: keys=${keys(attach)}`)
  }
} finally {
  await connection.close()
}
