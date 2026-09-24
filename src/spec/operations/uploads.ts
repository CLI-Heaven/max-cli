import * as v from "valibot"
import { defineOperation } from "../define.js"

const uploadRequest = v.strictObject({
  count: v.literal(1),
  type: v.literal(0),
  uploaderType: v.literal(0),
  profile: v.literal(false),
})

export const uploadsPhoto = defineOperation({
  name: "uploads.photo",
  constant: "PHOTO_UPLOAD",
  opcode: 80,
  auth: true,
  request: uploadRequest,
  response: v.looseObject({ url: v.optional(v.string()) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 in Saved messages (`pnpm probe:upload`)", "PyMax upload_photo"],
    notes:
      'Answers `{url}`. A multipart POST of the image, field `file`, answers `{photos: {<key>: {token}}}`; the message attaches `{_type: "PHOTO", photoToken}`.',
  },
})

export const uploadsFile = defineOperation({
  name: "uploads.file",
  constant: "FILE_UPLOAD",
  opcode: 87,
  auth: true,
  request: uploadRequest,
  response: v.looseObject({ info: v.optional(v.array(v.looseObject({}))) }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 in Saved messages (`pnpm probe:upload`)", "PyMax upload_file"],
    notes:
      'Answers `{info: [{url, fileId, token}]}`. The bytes are POSTed raw with `Content-Range: 0-<end>/<size>`; MAX then pushes 136 `{fileId}`, and a send before that is refused `attachment.not.ready`. The message attaches `{_type: "FILE", fileId}`.',
  },
})
