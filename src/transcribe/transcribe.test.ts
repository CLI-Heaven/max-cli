import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openCache } from "../cache/open.js"
import { openStore } from "../cache/store.js"
import type { MaxClient } from "../client.js"
import type { Message } from "../domain/models.js"
import { transcribe } from "./index.js"
import { install, isInstalled, vadPath } from "./install.js"
import { type SpeechModel, VAD } from "./models.js"
import { SAMPLE_RATE, toModelRate } from "./speech.js"

const tone = new Uint8Array(readFileSync(new URL("../testing/fixtures/tone.ogg", import.meta.url)))
const sha = (text: string) => createHash("sha256").update(text).digest("hex")

const tiny: SpeechModel = {
  id: "tiny",
  title: "tiny",
  languages: "none",
  featureDim: 64,
  files: [{ name: "model.onnx", url: "https://example.test/model.onnx", sha256: sha("weights"), bytes: 7 }],
  config: () => ({}),
}

/** The voice detector's file, at its size, so `install` has only the model left to fetch. */
const directoryWithVad = () => {
  const directory = mkdtempSync(join(tmpdir(), "max-models-"))
  writeFileSync(vadPath(directory), new Uint8Array(VAD.bytes))
  return directory
}

const serving = (body: string) => async () => new Response(body)

describe("installing a speech model", () => {
  it("**refuses a file whose sha256 is not the pinned one**, and leaves nothing behind", async () => {
    const directory = directoryWithVad()

    await expect(install(tiny, directory, { fetch: serving("tampered") })).rejects.toThrow(/not the file/)

    expect(isInstalled(tiny, directory)).toBe(false)
    expect(readdirSync(join(directory, "tiny"))).toEqual([])
  })

  it("installs a file that matches, and does not fetch it twice", async () => {
    const directory = directoryWithVad()
    let fetched = 0
    const fetch = async () => {
      fetched++
      return new Response("weights")
    }

    await install(tiny, directory, { fetch })
    await install(tiny, directory, { fetch })

    expect(isInstalled(tiny, directory)).toBe(true)
    expect(fetched).toBe(1)
  })
})

describe("audio for the model", () => {
  it("averages 48 kHz down to 16 kHz behind half a second of silence", () => {
    const pcm = toModelRate(new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]), 48_000)

    expect(pcm.length).toBe(SAMPLE_RATE / 2 + 2)
    expect(pcm.subarray(0, SAMPLE_RATE / 2).every((sample) => sample === 0)).toBe(true)
    expect([...pcm.subarray(SAMPLE_RATE / 2)].map((sample) => sample.toFixed(2))).toEqual(["0.30", "0.60"])
  })
})

describe("transcribing a voice message", () => {
  const voice: Message = {
    id: "2",
    chatId: "1",
    senderId: "7",
    senderName: "Someone",
    timestamp: new Date(1000).toISOString(),
    editedAt: null,
    text: "",
    outgoing: false,
    attachments: [],
    replyTo: null,
    forwardedFrom: null,
    reactions: null,
  }

  const setup = async () => {
    const directory = directoryWithVad()
    mkdirSync(join(directory, "tiny"))
    writeFileSync(join(directory, "tiny", "model.onnx"), "weights")
    const store = openStore({ database: await openCache(join(directory, "cache.db")) })
    store.messages.write("1", [voice])
    const calls: string[] = []
    const client = {
      messages: {
        links: async () => {
          calls.push("links")
          return { links: [{ kind: "audio", url: "https://example.test/voice.ogg" }], skipped: [] }
        },
      },
    } as unknown as MaxClient
    const heard: Float32Array[] = []
    const options = {
      model: tiny,
      directory,
      cache: store,
      release: async () => {
        calls.push("release")
      },
      fetchAudio: async () => tone,
      open: () => ({
        recognize: (pcm: Float32Array) => {
          calls.push("recognize")
          heard.push(pcm)
          return "привет"
        },
        free: () => {
          calls.push("free")
        },
      }),
    }
    return { store, client, calls, heard, options }
  }

  it("closes the connection before the model runs, and frees the model after", async () => {
    const { store, client, calls, heard, options } = await setup()

    const transcript = await transcribe(client, "1", "2", options)

    expect(transcript).toMatchObject({ text: "привет", model: "tiny", seconds: 1, cached: false })
    expect(calls).toEqual(["links", "release", "recognize", "free"])
    expect(heard[0]?.length).toBeGreaterThan(SAMPLE_RATE)
    store.close()
  })

  it("**answers a second time from the cache**, without MAX and without the model", async () => {
    const { store, client, calls, options } = await setup()
    await transcribe(client, "1", "2", options)
    calls.length = 0

    const again = await transcribe(client, "1", "2", options)

    expect(again).toMatchObject({ text: "привет", cached: true })
    expect(calls).toEqual([])
    store.close()
  })

  it("keeps the transcript when the same message is read again", async () => {
    const { store, client, options } = await setup()
    await transcribe(client, "1", "2", options)

    store.messages.write("1", [voice])

    expect(store.messages.transcript("1", "2")).toEqual({ text: "привет", model: "tiny" })
    store.close()
  })

  it("**does not download a model on its own** — it names the command that does", async () => {
    const { store, client, calls, options } = await setup()
    const missing = { ...tiny, id: "absent" }

    await expect(transcribe(client, "1", "2", { ...options, model: missing })).rejects.toThrow(
      /max models download absent/,
    )
    expect(calls).toEqual([])
    expect(existsSync(join(options.directory, "absent"))).toBe(false)
    store.close()
  })

  it("refuses a message with no voice recording", async () => {
    const { store, options } = await setup()
    const client = { messages: { links: async () => ({ links: [], skipped: [] }) } } as unknown as MaxClient

    await expect(transcribe(client, "1", "2", options)).rejects.toThrow(/no voice recording/)
    store.close()
  })
})
