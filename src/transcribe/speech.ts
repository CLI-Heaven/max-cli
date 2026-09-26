import { createRequire } from "node:module"
import type { SpeechModel } from "./models.js"

/** What transcription needs from a speech engine — small enough for a test to stand in for it. */
export interface Recognizer {
  recognize(pcm: Float32Array): string
  free(): void
}

export const SAMPLE_RATE = 16_000

/**
 * Half a second of silence ahead of the speech. Without it the voice detector clipped a recording
 * that starts talking at once: "Ничьих" came back as "чьих" (measured 2026-09-24).
 */
const LEAD = SAMPLE_RATE / 2

/**
 * MAX voice messages are Ogg Opus at 48 kHz (measured on a received one), and the models want
 * 16 kHz. Averaging each three samples is ours rather than the engine's resampler, which announces
 * itself on stderr on every call.
 */
export const toModelRate = (samples: Float32Array, rate: number): Float32Array => {
  const step = rate / SAMPLE_RATE
  const length = Math.floor(samples.length / step)
  const pcm = new Float32Array(LEAD + length)
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * step)
    const to = Math.max(from + 1, Math.floor((i + 1) * step))
    let sum = 0
    for (let j = from; j < to; j++) sum += samples[j] ?? 0
    pcm[LEAD + i] = sum / (to - from)
  }
  return pcm
}

export const decodeOgg = async (bytes: Uint8Array): Promise<{ samples: Float32Array; rate: number }> => {
  const { OggOpusDecoder } = await import("ogg-opus-decoder")
  const decoder = new OggOpusDecoder()
  await decoder.ready
  try {
    const { channelData, sampleRate, samplesDecoded } = await decoder.decodeFile(bytes)
    const samples = channelData[0]
    if (!samples || samplesDecoded === 0) throw new Error("no Ogg Opus audio in it")
    return { samples, rate: sampleRate }
  } finally {
    decoder.free()
  }
}

interface SherpaStream {
  acceptWaveform(rate: number, samples: Float32Array): void
  free(): void
}
interface Sherpa {
  createOfflineRecognizer(config: object): {
    createStream(): SherpaStream
    decode(stream: SherpaStream): void
    getResult(stream: SherpaStream): { text: string }
    free(): void
  }
  createVad(config: object): {
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    front(): { samples: Float32Array }
    pop(): void
    flush(): void
    reset(): void
    free(): void
  }
}

const WINDOW = 512

/**
 * The model, and a voice detector that cuts the audio at pauses into pieces of at most 20 seconds.
 * The cutting is not optional: five minutes in one piece crash the WebAssembly build (measured).
 *
 * `sherpa-onnx` is loaded here, on first use, so no other command pays for its 15 MB of WebAssembly.
 */
export const openRecognizer = (model: SpeechModel, path: (name: string) => string, vadModel: string): Recognizer => {
  const sherpa = createRequire(import.meta.url)("sherpa-onnx") as Sherpa
  const engine = sherpa.createOfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: model.featureDim },
    modelConfig: { ...model.config(path), numThreads: 1, provider: "cpu", debug: 0 },
    decodingMethod: "greedy_search",
  })
  const vad = sherpa.createVad({
    sileroVad: {
      model: vadModel,
      threshold: 0.5,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.25,
      maxSpeechDuration: 20,
      windowSize: WINDOW,
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: "cpu",
    debug: 0,
    bufferSizeInSeconds: 30,
  })

  const piece = (samples: Float32Array): string => {
    const stream = engine.createStream()
    try {
      stream.acceptWaveform(SAMPLE_RATE, samples)
      engine.decode(stream)
      return engine.getResult(stream).text.trim()
    } finally {
      stream.free()
    }
  }

  return {
    recognize: (pcm) => {
      // One recognizer can hear several recordings in a row; nothing of the last may leak into this one.
      vad.reset()
      const parts: string[] = []
      const drain = () => {
        while (!vad.isEmpty()) {
          parts.push(piece(vad.front().samples))
          vad.pop()
        }
      }
      for (let i = 0; i + WINDOW <= pcm.length; i += WINDOW) {
        vad.acceptWaveform(pcm.subarray(i, i + WINDOW))
        drain()
      }
      vad.flush()
      drain()
      return parts.filter(Boolean).join(" ")
    },
    free: () => {
      vad.free()
      engine.free()
    },
  }
}
