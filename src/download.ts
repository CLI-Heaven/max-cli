import { createWriteStream } from "node:fs"
import { link, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { CliError } from "@leemour/cli-core"
import type { AttachmentLink } from "./domain/models.js"
import { WEB_USER_AGENT } from "./spec/identity.js"

export interface Saved {
  kind: string
  path: string
  bytes: number
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
}

/** A name MAX gave cannot climb out of the directory, and cannot be a dot file we would then hide. */
const safeName = (name: string | undefined): string | undefined => {
  const plain = name === undefined ? "" : basename(name.replaceAll("\\", "/")).replace(/^\.+/, "")
  return plain === "" ? undefined : plain
}

/**
 * Downloads one attachment into `directory` and **never replaces a file that is there**.
 *
 * The bytes go to a temporary name first and are then hard-linked to the real one, which fails if
 * the name is taken — so an existing file survives, and an interrupted download leaves no half
 * file under the name somebody will open.
 */
export const save = async (attachment: AttachmentLink, directory: string, fallbackName: string): Promise<Saved> => {
  const response = await fetch(attachment.url, {
    headers: { "User-Agent": WEB_USER_AGENT.headerUserAgent, Referer: "https://web.max.ru/" },
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new CliError("network_error", `the ${attachment.kind} could not be downloaded: HTTP ${response.status}`)
  }

  const extension = EXTENSIONS[response.headers.get("content-type")?.split(";")[0]?.trim() ?? ""]
  const name = safeName(attachment.name) ?? (extension ? `${fallbackName}.${extension}` : fallbackName)
  const path = join(directory, name)
  const partial = join(directory, `.${name}.${process.pid}.part`)

  try {
    let bytes = 0
    const counted = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).on("data", (chunk) => {
      bytes += chunk.length
    })
    await pipeline(counted, createWriteStream(partial, { flags: "wx", mode: 0o600 }))
    await link(partial, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        throw new CliError("validation_error", `${path} already exists — nothing was overwritten; choose --output`)
      }
      throw error
    })
    return { kind: attachment.kind, path, bytes }
  } finally {
    await rm(partial, { force: true })
  }
}
