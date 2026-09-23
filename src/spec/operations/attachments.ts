import * as v from "valibot"
import { defineOperation } from "../define.js"
import { id } from "../scalars.js"

export const attachmentsFile = defineOperation({
  name: "attachments.file",
  constant: "FILE_DOWNLOAD",
  opcode: 88,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    messageId: id(),
    fileId: id(),
  }),
  response: v.looseObject({ url: v.optional(v.string()), unsafe: v.optional(v.boolean()) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-23 (`pnpm probe:download`)", "tsmax getFileById", "PyMax get_file_by_id"],
    notes:
      "A file attachment carries `fileId` and no link; this answers `{unsafe, url}`, and the link opens without credentials.",
  },
})

export const attachmentsVideo = defineOperation({
  name: "attachments.video",
  constant: "VIDEO_PLAY",
  opcode: 83,
  auth: true,
  request: v.strictObject({
    chatId: id(),
    messageId: id(),
    videoId: id(),
  }),
  response: v.looseObject({}),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-23 (`pnpm probe:download`)", "tsmax getVideoById", "PyMax get_video_by_id"],
    notes:
      "Answers `cache` and one key per rendition — `MP4_720`, `HLS`, `DASH`, `EXTERNAL` were seen. The MP4 link opens without credentials.",
  },
})
