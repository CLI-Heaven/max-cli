# Reading messages

Detail for [`ARCHITECTURE.md`](../ARCHITECTURE.md) §10: how messages print, what a message id
holds, and what an attachment carries.

**Status 2026-09-22: built; every wire fact below was measured on the real account that day.**

## The feed

`messages list` and `messages search` print a feed, not a table (`src/rendering/messages.ts`):

- a date line when the day changes; `hh:mm:ss  sender` and the text below, aligned;
- `↳` for what a reply answers, `↪` for a forward, `📎` per attachment;
- `-v` adds ids, `-vv` everything the model holds.

Pure functions return the string; the command writes it. Widths use `string-width`, never `length`,
so `张伟` and `👨‍💻` align. Colour goes through `util.styleText`, **but we decide when**: Node leaves
a pipe unstyled, Bun 1.3.14 styles it anyway (measured 2026-09-22). JSON is untouched; `--jsonl`
gives one object per line.

## A message id carries its time

Measured 2026-09-22 on three messages across two days: **`id >> 16` is the send time in
milliseconds, exactly**; the low 16 bits are a counter (`timeOfMessageId`). A message is located by
its id alone, with no stored copy.

`CHAT_HISTORY` from that time, measured the same day: `backward: n` gives n messages ending with it,
`forward: n` the n after it, oldest first; `0/0` gives nothing. `messages context` asks `before + 1`
back and `after` forward, and **refuses when the id is not in the answer**: MAX answers with the
nearest messages, and showing a neighbour as the one asked for would be a lie.

## Attachments carry their link

Measured 2026-09-22 with `pnpm probe:attachments` on a group chat:

| type | fields on the wire |
|---|---|
| `PHOTO` | `baseUrl` (https), `width`, `height`, `photoId`, `photoToken`, `previewData` |
| `SHARE` | `url`, `title`, `description`, `image`, `shareId` |

**The photo link opened with no cookie and no token** (`200`, `image/webp`), so it is shown as is
(`NEED-120`) and whoever holds it sees the picture. The model keeps `url`, `width`, `height` and
`title`; nothing else crosses the adapter.

A reply or forward carries **the other message whole**: `link: { type: "REPLY" | "FORWARD", chatId,
message: { id, sender, text, time, attaches } }` (same probe, 200 messages). The preview needs no
lookup, and `replyTo` / `forwardedFrom` are stored with the message (schema 4), so `--offline` shows
them too.
