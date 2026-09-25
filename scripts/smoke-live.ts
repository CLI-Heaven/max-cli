/**
 * Every writing operation once against the real MAX, before a release is announced (`MAX-56`).
 * Run by hand, never by CI, and only with the owner's yes (`NEED-150`).
 *
 *   pnpm smoke:live
 *
 * **One login, and Saved messages (chat 0) only.** It goes through `MaxClient`, the code the
 * commands run, on a single connection — driving the commands would be a login per write, since
 * `max serve` carries reads only. Everything it creates is deleted at the end, the folder included.
 *
 * Pin is not here: MAX pins only in groups, and our client refuses it in Saved messages before
 * sending. `pnpm probe:pre-release "<group>" MAX-58` covers it in a group.
 *
 * Printed: one line per step, `ok` or `FAIL` with MAX's own reason, and this script's own test
 * text. Never a message of the owner's, a name or an id.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MaxClient } from "../dist/client.js"
import { Connection } from "../dist/protocol/connection.js"
import { SessionStore } from "../dist/session/store.js"

const SAVED = "0"
const MULTIPLE = 2
const REVOTE = 4
const stamp = new Date().toISOString()

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
if (!store.readToken()) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const connection = new Connection({ timeoutMs: 20_000 })
const client = new MaxClient({ store, connection, timeoutMs: 20_000 })
const created: string[] = []
const failures: string[] = []

const reason = (error: unknown): string => {
  const payload = (error as { payload?: { error?: unknown } }).payload
  return String(payload?.error ?? (error as Error).message)
}

const step = async <T>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
  try {
    const result = await run()
    console.log(`ok    ${label}`)
    return result
  } catch (error) {
    console.log(`FAIL  ${label}: ${reason(error)}`)
    failures.push(label)
    return undefined
  }
}

const keep = (message: { id: string } | undefined): string | undefined => {
  if (message) created.push(message.id)
  return message?.id
}

const files = mkdtempSync(join(tmpdir(), "max-smoke-"))
const pixel = join(files, "pixel.png")
writeFileSync(
  pixel,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
)
const note = join(files, "note.txt")
writeFileSync(note, `max-cli smoke ${stamp}\n`)

try {
  await step("login", () => client.connect())

  const text = keep(await step("send text (64)", () => client.messages.send(SAVED, `max-cli smoke ${stamp}`)))
  keep(
    await step("send with markdown (64)", () =>
      client.messages.send(SAVED, "max-cli smoke **bold** _italic_ `code`", { markdown: true }),
    ),
  )
  if (text) {
    keep(await step("reply (64)", () => client.messages.send(SAVED, "max-cli smoke reply", { replyTo: text })))
    await step("edit", () => client.messages.edit(SAVED, text, `max-cli smoke ${stamp} (edited)`))
    await step("react", () => client.messages.react(SAVED, text, "👍"))
    await step("unreact", () => client.messages.unreact(SAVED, text))
    keep(await step("forward (64)", () => client.messages.forward(SAVED, text, SAVED)))
  }
  keep(await step("send a photo", () => client.messages.send(SAVED, "", { files: [pixel] })))
  keep(await step("send a file", () => client.messages.send(SAVED, "", { files: [note] })))

  const later = Date.now() + 90_000
  const scheduled = keep(
    await step("schedule a send (64, delayed)", () =>
      client.messages.send(SAVED, "max-cli smoke scheduled", { at: later }),
    ),
  )
  await step("list the scheduled (49, DELAYED)", async () => {
    const queued = await client.messages.scheduled(SAVED)
    if (scheduled && !queued.some((message) => message.id === scheduled)) throw new Error("not in the queue")
  })

  await step("mark read (50) — never measured before", () => client.chats.markRead(SAVED))
  await step("profile, unchanged", () => client.account.update({}))

  const folder = await step("create a folder", () => client.folders.create(`smoke ${stamp.slice(11, 19)}`))
  if (folder) {
    await step("rename the folder", () => client.folders.update(folder.id, { title: "max-cli smoke 2" }))
    await step("delete the folder", () => client.folders.delete(folder.id))
  }

  const poll = await step("create a poll (64, POLL) — refused over JSON", () =>
    connection.invoke(64, {
      chatId: 0n,
      message: {
        cid: Date.now(),
        text: "",
        attaches: [
          {
            _type: "POLL",
            title: `max-cli smoke poll ${stamp}`,
            answers: [{ text: "one" }, { text: "two" }],
            settings: REVOTE | MULTIPLE,
          },
        ],
      },
      notify: true,
    }),
  )
  const pollId = (poll?.message as { id?: unknown } | undefined)?.id
  if (pollId !== undefined) created.push(String(pollId))

  if (scheduled) {
    await step("wait for the scheduled send to fire (≤ 3 min)", async () => {
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        if (!(await client.messages.scheduled(SAVED)).some((message) => message.id === scheduled)) return
        await new Promise((resolve) => setTimeout(resolve, 15_000))
      }
      throw new Error("still queued after 3 minutes — cancel it in the MAX app")
    })
  }

  for (let start = 0; start < created.length; start += 10) {
    const batch = created.slice(start, start + 10)
    await step(`delete ${batch.length} test messages (66)`, () => client.messages.delete(SAVED, batch))
  }
} finally {
  await client.close().catch(() => {})
  rmSync(files, { recursive: true, force: true })
}

console.log(failures.length === 0 ? "\nall steps passed" : `\n${failures.length} failed: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
