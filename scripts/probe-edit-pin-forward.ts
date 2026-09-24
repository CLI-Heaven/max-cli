/**
 * How are a message edited, pinned and forwarded? Run by hand, never by CI.
 *
 *   pnpm probe:edit-pin-forward
 *
 * **Writes to the Saved-messages dialog (chat 0) and nowhere else** (`NEED-28`, `NEED-150`): a text
 * message and a photo, both edited, the text pinned and unpinned, and forwarded from chat 0 to
 * chat 0. The shapes are the web client's (web.max.ru, 2026-09-24) and PyMax's. Printed: field
 * names, enum values, counts and this script's own test text. The test messages stay; the owner
 * removes them by hand (`NEED-32`).
 *
 * ⚠ Forwarding from 0 to 0 cannot tell whether `link.chatId` names the source or the target.
 */

import type { Invoke } from "../dist/generated/client.generated.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { startSession } from "../dist/session/handshake.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { WEB_USER_AGENT } from "../dist/spec/identity.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const SAVED = 0n

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
const reason = (error: unknown) =>
  String(record((error as { payload?: unknown }).payload).error ?? (error as Error).message)

const connection = new Connection({ timeoutMs: 20_000 })
const invoke: Invoke = (operation, request) => connection.invoke(operation.opcode, buildRequest(operation, request))

/** A 1×1 PNG, so the probe needs no file of the owner's. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

let cid = Date.now()
/** What MAX calls chat 0 — the send answer names it; 55 refuses 0 itself (measured). */
let answeredChatId: unknown
const send = async (message: Json): Promise<string> => {
  cid += 1
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const answer = await connection.invoke(64, {
        chatId: SAVED,
        message: { cid, attaches: [], ...message },
        notify: true,
      })
      const id = asId(record(answer.message).id)
      if (!id) throw new Error(`no message id in the answer: ${keys(answer)}`)
      answeredChatId = answer.chatId ?? record(answer.message).chatId
      return id
    } catch (error) {
      if (reason(error) !== "attachment.not.ready") throw error
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  throw new Error("attachment never became ready")
}

const uploadPixel = async (): Promise<Json> => {
  const slot = await connection.invoke(80, { count: 1, type: 0, uploaderType: 0, profile: false })
  const form = new FormData()
  form.append("file", new Blob([PIXEL], { type: "image/png" }), "pixel.png")
  const response = await fetch(String(slot.url), {
    method: "POST",
    headers: {
      "User-Agent": WEB_USER_AGENT.headerUserAgent,
      Referer: "https://web.max.ru/",
      Origin: "https://web.max.ru",
    },
    body: form,
  })
  const photos = record(record(await response.json()).photos)
  const [first] = Object.values(photos)
  return { _type: "PHOTO", photoToken: record(first).token }
}

const readBack = async (ids: string[]): Promise<Map<string, Json>> => {
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
      interactive: false,
    }),
  )
  const found = new Map<string, Json>()
  for (const message of (Array.isArray(history.messages) ? history.messages : []).map(record)) {
    const id = asId(message.id)
    if (id && ids.includes(id)) found.set(id, message)
  }
  return found
}

const step = async (label: string, run: () => Promise<unknown>) => {
  try {
    const answer = await run()
    console.log(`${label}: ok, answer keys=${keys(answer)}`)
    return answer
  } catch (error) {
    console.log(`${label}: refused ${reason(error)}`)
    return undefined
  }
}

/** Paths and values of every login field whose name mentions editing — settings, not content. */
const editSettings = (value: unknown, path = ""): string[] => {
  const found: string[] = []
  for (const [key, inner] of Object.entries(record(value))) {
    const here = path ? `${path}.${key}` : key
    if (/edit/i.test(key) && typeof inner !== "object") found.push(`${here}=${String(inner)}`)
    else if (typeof inner === "object" && inner !== null && !Array.isArray(inner))
      found.push(...editSettings(inner, here))
  }
  return found
}

try {
  await connection.open()
  const login = await startSession(invoke, { token, deviceId: store.readState().deviceId, chatsCount: 100 })
  console.log(`login settings about editing: ${editSettings(login).join(" ") || "none"}`)

  // Chat 0 is refused by 55 (measured): the dialog with yourself has a real id, with you its only participant.
  const own = (Array.isArray(record(login).chats) ? (record(login).chats as unknown[]) : [])
    .map(record)
    .filter((chat) => chat.type === "DIALOG" && Object.keys(record(chat.participants)).length === 1)
  console.log(`dialogs with one participant: ${own.length}`)
  const pin = async (messageId: string) => {
    if (answeredChatId === undefined) return console.log("pin skipped: no send answer named the chat")
    const savedId = BigInt(String(asId(answeredChatId)))
    console.log(
      `  send answer's chat is the one-participant dialog: ${own.some((chat) => asId(chat.id) === asId(answeredChatId))}`,
    )
    const pinned = await step("pin (55) by the dialog's real id, notifyPin false", () =>
      connection.invoke(55, { chatId: savedId, notifyPin: false, pinMessageId: BigInt(messageId) }),
    )
    const chat = record(record(pinned).chat)
    console.log(
      `  chat fields about pins: ${
        Object.keys(chat)
          .filter((key) => /pin/i.test(key))
          .join(",") || "none"
      }`,
    )
    console.log(`  pinned message is ours: ${asId(record(chat.pinnedMessage).id) === messageId}`)
    const unpinned = await step("unpin (55), pinMessageId 0", () =>
      connection.invoke(55, { chatId: savedId, notifyPin: false, pinMessageId: 0n }),
    )
    const after = record(record(unpinned).chat)
    console.log(
      `  after unpin: pin fields ${
        Object.keys(after)
          .filter((key) => /pin/i.test(key))
          .join(",") || "none"
      }`,
    )
  }

  if (process.env.PIN_ONLY) {
    await pin(await send({ text: "max-cli probe: pin target" }))
    process.exit(0)
  }

  const text = await send({ text: "max-cli probe: to be edited" })
  const photo = await send({ text: "max-cli probe: photo", attaches: [await uploadPixel()] })
  console.log(`sent text ${text}, photo ${photo}`)

  await step("edit text (67), id as bigint", () =>
    connection.invoke(67, {
      chatId: SAVED,
      messageId: BigInt(text),
      text: "max-cli probe: edited",
      elements: [],
      attachments: [],
    }),
  )

  const before = (await readBack([photo])).get(photo) ?? {}
  const attaches = Array.isArray(before.attaches) ? before.attaches : []
  console.log(`photo as history gives it: attaches=${attaches.length} keys=${attaches.map(keys).join(" | ")}`)
  await step("edit photo caption, attachments sent back as history gave them", () =>
    connection.invoke(67, {
      chatId: SAVED,
      messageId: BigInt(photo),
      text: "max-cli probe: photo, edited once",
      elements: [],
      attachments: attaches,
    }),
  )
  console.log(
    `  photo attaches after: ${((await readBack([photo])).get(photo)?.attaches as unknown[] | undefined)?.length ?? "?"}`,
  )
  await step("edit photo caption, attachments: []", () =>
    connection.invoke(67, {
      chatId: SAVED,
      messageId: BigInt(photo),
      text: "max-cli probe: photo, edited twice",
      elements: [],
      attachments: [],
    }),
  )
  console.log(
    `  photo attaches after: ${((await readBack([photo])).get(photo)?.attaches as unknown[] | undefined)?.length ?? "?"}`,
  )

  await pin(text)

  cid += 1
  const forwarded = await step("forward (64) with no text and no elements", () =>
    connection.invoke(64, {
      chatId: SAVED,
      message: { cid, link: { type: "FORWARD", messageId: BigInt(text), chatId: SAVED }, attaches: [] },
      notify: true,
    }),
  )
  const forwardId = asId(record(record(forwarded).message).id)

  const found = await readBack([text, photo, ...(forwardId ? [forwardId] : [])])
  for (const [label, id] of [
    ["text", text],
    ["photo", photo],
    ["forward", forwardId],
  ] as const) {
    const message = id ? found.get(id) : undefined
    if (!message) {
      console.log(`\n${label}: not read back`)
      continue
    }
    const link = record(message.link)
    console.log(
      `\n${label} read back: status=${String(message.status)} updateTime set=${message.updateTime !== undefined}`,
    )
    console.log(
      `  text: ${JSON.stringify(message.text)}  attaches=${Array.isArray(message.attaches) ? message.attaches.length : "?"}`,
    )
    if (message.link) {
      console.log(`  link: type=${String(link.type)} keys=${keys(link)} message keys=${keys(link.message)}`)
      console.log(`  link points at text: ${asId(link.messageId ?? record(link.message).id) === text}`)
    }
  }
} finally {
  await connection.close()
}
