/**
 * Two claims about reading, measured at once (`RES-11`, and the fix of #122). Run by hand, never by
 * CI, and only with the owner's yes.
 *
 *   pnpm probe:read-mark            # the first channel with 2+ unread posts
 *   pnpm probe:read-mark <chat>     # or this one: an id or the exact title
 *
 * One login. In a chat with at least two unread messages it
 * 1. reads the last two **without** `interactive`, as the web client's history request is sent;
 * 2. marks read up to the older of the two, with `mark` = that message's time.
 * If MAX then answers `unread: 1`, reading marked nothing and the mark works by time, so the newest
 * stays unread. `0` cannot tell the two apart. The older message is marked read — that is the
 * owner's yes; a channel shows no reader to a person the way a dialog does.
 *
 * Printed: the chat's kind, counts and the verdict. Never a title, an id or a text.
 */
import { MaxClient } from "../dist/client.js"
import { Connection } from "../dist/protocol/connection.js"
import { asId } from "../dist/protocol/frame.js"
import { SessionStore } from "../dist/session/store.js"
import { buildRequest } from "../dist/spec/define.js"
import { chatsHistory } from "../dist/spec/operations/chats.js"

const store = new SessionStore({ profile: process.env.MAX_PROFILE ?? "default" })
if (!store.readToken()) {
  console.error("no session on this profile — run `max session start` first")
  process.exit(2)
}

const connection = new Connection({ timeoutMs: 20_000 })
const client = new MaxClient({ store, connection, timeoutMs: 20_000 })
let code = 0

try {
  await client.connect()
  const chats = (await client.chats.list({ limit: 100 })).items
  const wanted = process.argv[2]
  const target = wanted
    ? chats.find((chat) => chat.id === wanted || chat.title === wanted)
    : chats.find((chat) => chat.kind === "channel" && (chat.unreadCount ?? 0) >= 2)
  if (!target || (target.unreadCount ?? 0) < 2) {
    console.error("no chat with 2 or more unread messages — wait for new posts, or pass a chat id")
    code = 3
  } else {
    console.log(`chat: a ${target.kind} with ${target.unreadCount} unread`)

    const answer = await connection.invoke(
      chatsHistory.opcode,
      buildRequest(chatsHistory, { chatId: target.id, from: Date.now(), forward: 0, backward: 2, getMessages: true }),
    )
    const ids = (Array.isArray(answer.messages) ? answer.messages : [])
      .map((message) => message as { id?: unknown; time?: number })
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
      .map((message) => asId(message.id))
      .filter((id): id is string => id !== undefined)
    console.log(`read the last ${ids.length} without \`interactive\``)

    const older = ids.at(-2)
    if (!older) {
      console.error("fewer than two messages came back")
      code = 4
    } else {
      const mark = await client.chats.markRead(target.id, older)
      console.log(`marked read up to the older one → MAX says unread: ${mark.unread}`)
      if (mark.unread === 1) {
        console.log("verdict: reading without `interactive` marked nothing, and the mark works by time (RES-11, #122)")
      } else if (mark.unread === 0) {
        console.log("verdict: unclear — either reading marked it all, or the mark does not stop at the message")
        code = 1
      } else {
        console.log(`verdict: unexpected — more messages arrived meanwhile, or the count is not per message`)
        code = 1
      }
    }
  }
} catch (error) {
  console.error(`failed: ${(error as Error).message}`)
  code = 1
} finally {
  await client.close().catch(() => {})
}
process.exit(code)
