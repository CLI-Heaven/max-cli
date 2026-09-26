import type { CacheStore } from "./cache/index.js"
import type { MaxClient } from "./client.js"
import type { Review } from "./domain/models.js"
import { notDownloaded, openInstalled, transcribe } from "./transcribe/index.js"
import { isInstalled, modelsDirectory } from "./transcribe/install.js"
import { type SpeechModel, speechModel } from "./transcribe/models.js"
import type { Recognizer } from "./transcribe/speech.js"

/** Owner's ruling: without a boundary, a review looks at the last three days. */
export const REVIEW_DAYS = 3

export const reviewStart = (now = Date.now()): number => now - REVIEW_DAYS * 86_400_000

export interface ReviewOptions {
  since: number
  cache: CacheStore | undefined
  /** Transcribe voice messages not heard yet, with this model; otherwise only texts already kept. */
  transcribeWith?: string
}

/**
 * `max review` and `max_review` alike. A text already heard comes from the cache with no model
 * loaded; with `transcribeWith`, the rest are transcribed one by one. A missing model or a recording
 * that will not decode is a field in the answer, not a failed review: the messages are still worth
 * reading. The model is never downloaded from here (`NEED-231`).
 */
export const review = async (client: MaxClient, { since, cache, transcribeWith }: ReviewOptions): Promise<Review> => {
  const read = await client.inbox.review({ since })
  const unheard: Review["unheard"] = []
  const model = transcribeWith === undefined ? undefined : speechModel(transcribeWith)
  const directory = modelsDirectory()
  let transcribeProblem = model && !isInstalled(model, directory) ? notDownloaded(model).message : undefined
  const canTranscribe = model !== undefined && transcribeProblem === undefined
  // Loading takes seconds and up to 1.3 GB, so one recognizer hears every voice message of the review.
  let loaded: Recognizer | undefined
  const shared = (speech: SpeechModel, at: string): Recognizer => {
    loaded ??= openInstalled(speech, at)
    const recognizer = loaded
    return { recognize: (pcm) => recognizer.recognize(pcm), free: () => {} }
  }

  try {
    for (const chat of read.chats) {
      for (const message of chat.messages) {
        if (!message.attachments.some(({ kind }) => kind === "audio")) continue
        const kept = cache?.messages.transcript(chat.id, message.id)
        if (kept) {
          message.transcript = kept.text
          continue
        }
        if (canTranscribe) {
          try {
            message.transcript = (
              await transcribe(client, chat.id, message.id, { model, directory, cache, open: shared })
            ).text
            continue
          } catch (error) {
            transcribeProblem ??= error instanceof Error ? error.message : String(error)
          }
        }
        unheard.push({ chatId: chat.id, messageId: message.id })
      }
    }
  } finally {
    loaded?.free()
  }

  const complete =
    read.skipped.length === 0 && !read.partial && unheard.length === 0 && read.chats.every((chat) => !chat.more)
  return { ...read, complete, unheard, ...(transcribeProblem === undefined ? {} : { transcribeProblem }) }
}
