import { CliError } from "@leemour/cli-core"

/**
 * The speech models `max messages transcribe` can use, each **pinned to one commit** and checked by
 * sha256: a file that does not match is refused, so nobody else's model runs in a program that
 * holds the owner's session.
 *
 * Measured 2026-09-24 through the WebAssembly build of sherpa-onnx, one thread, a Ryzen AI 9 HX 470
 * laptop, 5 minutes of Ogg Opus cut by VAD, Node 24 and Bun 1.3.14 alike (`FIND-131`, `FIND-133`):
 * `gigaam-v3` ×7 real time, `gigaam-v3-ctc` ×8, `parakeet-v3` ×5 and 1.3 GB of memory. Whisper small
 * ran at ×1.1 and is not offered.
 */
export interface ModelFile {
  name: string
  url: string
  sha256: string
  bytes: number
}

export interface SpeechModel {
  id: string
  title: string
  languages: string
  files: ModelFile[]
  /** The part of sherpa-onnx's `modelConfig` that names the files, given where they are. */
  config: (path: (name: string) => string) => Record<string, unknown>
  featureDim: number
}

const huggingFace = (repository: string, commit: string) => (name: string) =>
  `https://huggingface.co/csukuangfj/${repository}/resolve/${commit}/${name}`

const gigaam = huggingFace(
  "sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16",
  "a6039be7cee829a9044a69ac0ebaf1c191217c97",
)
const gigaamCtc = huggingFace(
  "sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16",
  "4fb5407ff028a69fec516cdf4c10fac9ddea7c16",
)
const parakeet = huggingFace("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", "2bda32ec70b097a55adaa07d9a7173915b43cc78")

export const MODELS: SpeechModel[] = [
  {
    id: "gigaam-v3",
    title: "GigaAM v3, with punctuation",
    languages: "Russian",
    featureDim: 64,
    files: [
      {
        name: "encoder.int8.onnx",
        url: gigaam("encoder.int8.onnx"),
        sha256: "369f35a71bf288d3b8e0391fabd8dba5f2314088d440bca474056b7b4b6e66bf",
        bytes: 224_570_820,
      },
      {
        name: "decoder.onnx",
        url: gigaam("decoder.onnx"),
        sha256: "38fc7475443ea2a26f63211ca350f73ac50fff824ab7a3876ee2bd610c53bbc4",
        bytes: 4_600_132,
      },
      {
        name: "joiner.onnx",
        url: gigaam("joiner.onnx"),
        sha256: "602ff7017a93311aad34df1437c8d7f49911353c13d6eae7a6ee7b041339465c",
        bytes: 2_712_896,
      },
      {
        name: "tokens.txt",
        url: gigaam("tokens.txt"),
        sha256: "39abae20e692998290c574e606f11a9edef2902a1995463fcff63d1490cf22b7",
        bytes: 13_354,
      },
    ],
    config: (path) => ({
      transducer: { encoder: path("encoder.int8.onnx"), decoder: path("decoder.onnx"), joiner: path("joiner.onnx") },
      tokens: path("tokens.txt"),
      modelType: "nemo_transducer",
    }),
  },
  {
    id: "gigaam-v3-ctc",
    title: "GigaAM v3 CTC, with punctuation — a little faster",
    languages: "Russian",
    featureDim: 64,
    files: [
      {
        name: "model.int8.onnx",
        url: gigaamCtc("model.int8.onnx"),
        sha256: "d5fea8df94263c285e54b21e5774b707c707192d3bdbeffd7b1eb07fb6743b35",
        bytes: 224_893_661,
      },
      {
        name: "tokens.txt",
        url: gigaamCtc("tokens.txt"),
        sha256: "142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd",
        bytes: 2_007,
      },
    ],
    config: (path) => ({ nemoCtc: { model: path("model.int8.onnx") }, tokens: path("tokens.txt") }),
  },
  {
    id: "parakeet-v3",
    title: "NVIDIA Parakeet TDT 0.6B v3",
    languages: "25 European languages, Russian, English and Spanish among them",
    featureDim: 80,
    files: [
      {
        name: "encoder.int8.onnx",
        url: parakeet("encoder.int8.onnx"),
        sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
        bytes: 652_184_281,
      },
      {
        name: "decoder.int8.onnx",
        url: parakeet("decoder.int8.onnx"),
        sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
        bytes: 11_845_275,
      },
      {
        name: "joiner.int8.onnx",
        url: parakeet("joiner.int8.onnx"),
        sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
        bytes: 6_355_277,
      },
      {
        name: "tokens.txt",
        url: parakeet("tokens.txt"),
        sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
        bytes: 93_939,
      },
    ],
    config: (path) => ({
      transducer: {
        encoder: path("encoder.int8.onnx"),
        decoder: path("decoder.int8.onnx"),
        joiner: path("joiner.int8.onnx"),
      },
      tokens: path("tokens.txt"),
      modelType: "nemo_transducer",
    }),
  },
]

/** Cuts speech at pauses. Every model needs it: five minutes in one piece crash the WebAssembly build. */
export const VAD: ModelFile = {
  name: "silero_vad.onnx",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
  sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
  bytes: 643_854,
}

export const DEFAULT_MODEL = "gigaam-v3"

export const findModel = (id: string): SpeechModel | undefined => MODELS.find((model) => model.id === id)

export const speechModel = (id: string): SpeechModel => {
  const model = findModel(id)
  if (!model) {
    throw new CliError(
      "validation_error",
      `no speech model "${id}" — one of ${MODELS.map((known) => known.id).join(", ")}`,
    )
  }
  return model
}
