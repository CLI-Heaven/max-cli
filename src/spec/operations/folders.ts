import * as v from "valibot"
import { defineOperation } from "../define.js"
import { id } from "../scalars.js"

const webClient = "web.max.ru chunk `_app/immutable/chunks/5oCuRT0F.js`, read 2026-09-24"

const Folder = {
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
  include: v.optional(v.array(id())),
  /** Sent back as they came: nobody has described what they hold. */
  filters: v.array(v.unknown()),
  options: v.array(v.unknown()),
  favorites: v.optional(v.array(v.unknown())),
}

export const foldersList = defineOperation({
  name: "folders.list",
  constant: "FOLDERS_GET",
  opcode: 272,
  auth: true,
  request: v.strictObject({ folderSync: v.number() }),
  response: v.looseObject({
    folders: v.optional(v.array(v.looseObject({}))),
    foldersOrder: v.optional(v.array(v.unknown())),
    folderSync: v.optional(v.number()),
  }),
  guard: null,
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:account`): no folder of the owner's carries `include`",
      webClient,
      "PyMax 53103f0 `get_folders`",
    ],
  },
})

export const foldersUpdate = defineOperation({
  name: "folders.update",
  constant: "FOLDERS_UPDATE",
  opcode: 274,
  auth: true,
  request: v.strictObject(Folder),
  response: v.looseObject({ folder: v.optional(v.looseObject({})), folderSync: v.optional(v.number()) }),
  // A new folder and a changed one look the same on the wire — both carry an id — so the journal
  // calls both an update; either needs the same permission.
  guard: () => ({ chatId: null, kind: "account", action: "folder-update" }),
  provenance: {
    confidence: "measured",
    sources: [
      "measured against MAX 2026-09-24 (`pnpm probe:account`): created, renamed and deleted a folder; a 21-character title came back `folder.validation.title.too-long`, 15 was taken",
      webClient,
      "PyMax 53103f0 `create_folder`, `update_folder`",
    ],
    notes:
      "Creates a folder under an id it has not seen, replaces one it has. **The whole folder**: the web client sends every field back, and PyMax's `include or []` would empty a folder whose title changed.",
  },
})

export const foldersDelete = defineOperation({
  name: "folders.delete",
  constant: "FOLDERS_DELETE",
  opcode: 276,
  auth: true,
  request: v.strictObject({ folderIds: v.array(v.pipe(v.string(), v.minLength(1))) }),
  response: v.looseObject({}),
  guard: () => ({ chatId: null, kind: "account", action: "folder-delete" }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24 (`pnpm probe:account`)", webClient, "PyMax 53103f0 `delete_folder`"],
    notes: "Deletes the folder, not the chats in it.",
  },
})
