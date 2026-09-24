import { CliError } from "@leemour/cli-core"
import type { CacheStore } from "../cache/index.js"
import type { MaxClient } from "../client.js"
import type { AttachmentLink, Id } from "../domain/models.js"
import { fetchBytes } from "../download.js"
import { installedBytes, isInstalled, megabytes, modelPath, vadPath } from "./install.js"
import { type SpeechModel, VAD } from "./models.js"
import { decodeOgg, openRecognizer, type Recognizer, toModelRate } from "./speech.js"

export interface Transcript {
  chatId: Id
  messageId: Id
  text: string
  model: string
  /** Length of the recording; `null` when the text came from the cache. */
  seconds: number | null
  cached: boolean
}

export interface TranscribeOptions {
  model: SpeechModel
  directory: string
  cache?: CacheStore | undefined
  /** Called once the audio is in hand, so the connection closes before the long part begins. */
  release?: () => Promise<void>
  fetchAudio?: (link: AttachmentLink) => Promise<Uint8Array>
  open?: (model: SpeechModel, directory: string) => Recognizer
}

export const notDownloaded = (model: SpeechModel): CliError =>
  new CliError(
    "not_found",
    `the speech model ${model.id} is not downloaded — \`max models download ${model.id}\` fetches it ` +
      `(${megabytes(installedBytes(model) + VAD.bytes)}, once)`,
  )

const openInstalled = (model: SpeechModel, directory: string): Recognizer =>
  openRecognizer(model, modelPath(directory, model), vadPath(directory))

/**
 * One voice message to text, on this machine. A text already heard by the same model comes from
 * the cache, with no connection and no model loaded.
 *
 * ⚠ **The model is never downloaded from here** (`NEED-231`): an agent calling this through MCP must
 * not start a 230–670 MB download. The refusal names the command that does it.
 */
export const transcribe = async (
  client: MaxClient,
  chatId: Id,
  messageId: Id,
  { model, directory, cache, release, fetchAudio = fetchBytes, open = openInstalled }: TranscribeOptions,
): Promise<Transcript> => {
  const kept = cache?.messages.transcript(chatId, messageId)
  if (kept && kept.model === model.id) {
    return { chatId, messageId, text: kept.text, model: model.id, seconds: null, cached: true }
  }

  if (!isInstalled(model, directory)) throw notDownloaded(model)

  const { links } = await client.messages.links(chatId, messageId)
  const voice = links.find((link) => link.kind === "audio")
  if (!voice) throw new CliError("validation_error", `message ${messageId} has no voice recording to transcribe`)
  const bytes = await fetchAudio(voice)
  await release?.()

  const { samples, rate } = await decodeOgg(bytes).catch((error: Error) => {
    throw new CliError("invalid_response", `the recording could not be read as Ogg Opus: ${error.message}`)
  })
  const pcm = toModelRate(samples, rate)
  const recognizer = open(model, directory)
  try {
    const text = recognizer.recognize(pcm)
    cache?.messages.keepTranscript(chatId, messageId, text, model.id)
    return { chatId, messageId, text, model: model.id, seconds: Math.round(samples.length / rate), cached: false }
  } finally {
    recognizer.free()
  }
}
