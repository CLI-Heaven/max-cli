import { createHash } from "node:crypto"
import { createWriteStream, mkdirSync, statSync } from "node:fs"
import { rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { CliError, resolvePaths } from "@leemour/cli-core"
import { type ModelFile, type SpeechModel, VAD } from "./models.js"

/** Beside the profile caches, so `max cache clear` — which empties a database — leaves them alone. */
export const modelsDirectory = (env: NodeJS.ProcessEnv = process.env): string =>
  join(resolvePaths({ appName: "max-cli", prefix: "MAX", env }).cache, "models")

export const modelPath = (directory: string, model: SpeechModel) => (name: string) => join(directory, model.id, name)

export const vadPath = (directory: string): string => join(directory, VAD.name)

const placed = (model: SpeechModel, directory: string): [ModelFile, string][] => [
  ...model.files.map((file): [ModelFile, string] => [file, modelPath(directory, model)(file.name)]),
  [VAD, vadPath(directory)],
]

/**
 * Size, not hash: hashing 650 MB on every call would cost more than the transcription. The hash is
 * checked once, as the file arrives, and a file only reaches its name after passing it.
 */
export const isInstalled = (model: SpeechModel, directory: string): boolean =>
  placed(model, directory).every(([file, path]) => sizeOf(path) === file.bytes)

const sizeOf = (path: string): number | undefined => {
  try {
    return statSync(path).size
  } catch {
    return undefined
  }
}

export const installedBytes = (model: SpeechModel): number => model.files.reduce((sum, file) => sum + file.bytes, 0)

export type Fetch = (url: string) => Promise<Response>

export const install = async (
  model: SpeechModel,
  directory: string,
  { fetch: get = fetch, progress }: { fetch?: Fetch; progress?: (line: string) => void } = {},
): Promise<void> => {
  mkdirSync(join(directory, model.id), { recursive: true, mode: 0o700 })
  for (const [file, path] of placed(model, directory)) {
    if (sizeOf(path) === file.bytes) continue
    progress?.(`downloading ${file.name} (${megabytes(file.bytes)})`)
    await fetchVerified(file, path, get)
  }
}

const fetchVerified = async (file: ModelFile, path: string, get: Fetch): Promise<void> => {
  const response = await get(file.url)
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new CliError("network_error", `${file.name} could not be downloaded: HTTP ${response.status}`)
  }

  const partial = `${path}.${process.pid}.part`
  const hash = createHash("sha256")
  const hashing = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk)
      done(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      hashing,
      createWriteStream(partial, { mode: 0o600 }),
    )
    const actual = hash.digest("hex")
    if (actual !== file.sha256) {
      throw new CliError(
        "invalid_response",
        `${file.name} is not the file this version of max expects (sha256 ${actual}) — nothing was installed`,
      )
    }
    await rename(partial, path)
  } finally {
    await rm(partial, { force: true })
  }
}

export const megabytes = (bytes: number): string =>
  bytes < 1_000_000 ? "under 1 MB" : `${Math.round(bytes / 1_000_000)} MB`
