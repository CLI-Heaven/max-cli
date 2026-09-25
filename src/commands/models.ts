import { Command } from "commander"
import { install, installedBytes, isInstalled, megabytes, modelsDirectory } from "../transcribe/install.js"
import { MODELS, speechModel, VAD } from "../transcribe/models.js"
import { forCommand } from "./context.js"

/**
 * Local models, by what they work on. `audio` is the speech models behind `max messages transcribe`;
 * nothing here talks to MAX.
 */
export const modelsCommand = (): Command => {
  const models = new Command("models").description("models that run on this machine")
  const command = models.command("audio").description("speech models for transcribing voice messages")

  command
    .command("list")
    .description("the models max can use, which are downloaded, and which one is the default")
    .action(async function (this: Command) {
      const { renderer, format, streams, settings, run } = forCommand(this)
      await run("models audio list", async () => {
        const directory = modelsDirectory()
        const items = MODELS.map((model) => ({
          id: model.id,
          title: model.title,
          languages: model.languages,
          size: megabytes(installedBytes(model)),
          downloaded: isInstalled(model, directory),
          default: model.id === settings.transcribeModel,
        }))
        if (format !== "pretty") {
          renderer.result({ items })
          return
        }
        const lines = items.map(
          (item) =>
            `${item.default ? "*" : " "} ${item.id.padEnd(14)} ${item.size.padStart(7)}  ${item.downloaded ? "downloaded" : "—".padEnd(10)}  ${item.languages}`,
        )
        streams.data(`${lines.join("\n")}\n`)
      })
    })

  command
    .command("download")
    .argument("<model>", "a model id from `max models audio list`")
    .description("download a speech model once, checked against the sha256 this version of max expects")
    .action(async function (this: Command, id: string) {
      const { renderer, run } = forCommand(this)
      await run("models audio download", async () => {
        const model = speechModel(id)
        const directory = modelsDirectory()
        if (!isInstalled(model, directory)) {
          renderer.note(`${model.id}: ${megabytes(installedBytes(model) + VAD.bytes)} from Hugging Face and GitHub`)
          await install(model, directory, { progress: (line) => renderer.note(line) })
        }
        renderer.result({ id: model.id, downloaded: true, directory })
      })
    })

  return models
}
