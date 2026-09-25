import { readFile } from "node:fs/promises"
import { basename, extname } from "node:path"
import { CliError } from "@leemour/cli-core"
import { WEB_USER_AGENT } from "./spec/identity.js"

const HEADERS = {
  "User-Agent": WEB_USER_AGENT.headerUserAgent,
  Referer: "https://web.max.ru/",
  Origin: "https://web.max.ru",
}

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

export const isImage = (path: string): boolean => extname(path).toLowerCase() in IMAGE_TYPES

export const readUpload = async (path: string): Promise<Buffer> => {
  try {
    return await readFile(path)
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : "it cannot be read"
    throw new CliError("validation_error", `cannot send ${path}: ${reason}`)
  }
}

/** The whole upload, not a stall: `fetch` reports no progress on a body it sends. */
const UPLOAD_MS = 15 * 60_000

const uploadDeadline = () => AbortSignal.timeout(UPLOAD_MS)

const refused = (kind: string, status: number) =>
  new CliError("network_error", `the ${kind} could not be uploaded: HTTP ${status} — nothing was sent`)

/** Measured 2026-09-24: a multipart POST, field `file`, answers `{photos: {<key>: {token}}}`. */
export const uploadPhoto = async (url: string, path: string, bytes: Buffer): Promise<string> => {
  const form = new FormData()
  const type = IMAGE_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  form.append("file", new Blob([bytes], { type }), `image${extname(path).toLowerCase()}`)

  const response = await fetch(url, { method: "POST", headers: HEADERS, body: form, signal: uploadDeadline() })
  if (!response.ok) throw refused("photo", response.status)
  const answer = (await response.json().catch(() => ({}))) as { photos?: Record<string, { token?: unknown }> }
  const token = Object.values(answer.photos ?? {})[0]?.token
  if (typeof token !== "string")
    throw new CliError("provider_error", "the photo upload answered no token — nothing was sent")
  return token
}

/**
 * Measured 2026-09-24: the bytes raw, with `Content-Range: 0-<end>/<size>` — no `bytes ` unit, as
 * PyMax sends it and MAX accepted.
 */
export const uploadFile = async (url: string, path: string, bytes: Buffer): Promise<void> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Disposition": `attachment; filename=${encodeURIComponent(basename(path))}`,
      "Content-Range": `0-${bytes.length - 1}/${bytes.length}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
    signal: uploadDeadline(),
  })
  await response.body?.cancel()
  if (!response.ok) throw refused("file", response.status)
}
