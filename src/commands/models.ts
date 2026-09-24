import { Command } from "commander"
import { install, installedBytes, isInstalled, megabytes, modelsDirectory } from "../transcribe/install.js"
import { MODELS, speechModel, VAD } from "../transcribe/models.js"
import { forCommand } from "./context.js"

/** The speech models for `max messages transcribe`. Nothing here talks to MAX. */
export const modelsCommand = (): Command => {
  const command = new Command("models").description("speech models for transcribing voice messages")

  command
    .command("list")
    .description("the models max can use, which are downloaded, and which one is the default")
    .action(function (this: Command) {
      const { renderer, format, streams, settings } = forCommand(this)
      const directory = modelsDirectory()
      const items = MODELS.map((model) => ({
        id: model.id,
        title: model.title,
        languages: model.languages,
        size: megabytes(installedBytes(model)),
        downloaded: isInstalled(model, directory),
        default: model.id === settings.transcribeModel,
      }))
      if (format !== "pretty") return renderer.result({ items })
      const lines = items.map(
        (item) =>
          `${item.default ? "*" : " "} ${item.id.padEnd(14)} ${item.size.padStart(7)}  ${item.downloaded ? "downloaded" : "—".padEnd(10)}  ${item.languages}`,
      )
      streams.data(`${lines.join("\n")}\n`)
    })

  command
    .command("download")
    .argument("<model>", "a model id from `max models list`")
    .description("download a speech model once, checked against the sha256 this version of max expects")
    .action(async function (this: Command, id: string) {
      const { renderer } = forCommand(this)
      const model = speechModel(id)
      const directory = modelsDirectory()
      if (!isInstalled(model, directory)) {
        renderer.note(`${model.id}: ${megabytes(installedBytes(model) + VAD.bytes)} from Hugging Face and GitHub`)
        await install(model, directory, { progress: (line) => renderer.note(line) })
      }
      renderer.result({ id: model.id, downloaded: true, directory })
    })

  return command
}
