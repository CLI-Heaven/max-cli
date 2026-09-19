import { createRenderer, type Renderer, type RenderFormat, type Streams } from "@cli-heaven/cli-core"

export interface OutputOptions {
  json?: boolean
  quiet?: boolean
  streams?: Streams
  /** Whether a person is looking. Defaults to whether stdout is a terminal. */
  tty?: boolean
  color?: boolean
}

/**
 * One place decides the mode, so no command can disagree with another.
 *
 * `--json` forces machine output; otherwise a terminal gets the pretty renderer and a pipe gets
 * JSON, because a pipe is a script until proven otherwise. In every machine mode **stdout carries
 * one JSON value and nothing else** — diagnostics are on stderr in all modes, which is what makes
 * that contract hold by construction rather than by remembering.
 */
export const resolveOutput = ({ json, quiet, streams, tty, color }: OutputOptions = {}) => {
  const interactive = tty ?? process.stdout.isTTY === true
  const format: RenderFormat = json || !interactive ? "json" : "pretty"
  const renderer = createRenderer({
    format,
    color: color ?? (format === "pretty" && process.env.NO_COLOR === undefined),
    ...(streams ? { streams } : {}),
  })

  return { format, renderer: quiet ? silence(renderer) : renderer }
}

/**
 * Everything diagnostic, and **not** `failure`: an exit code says which kind of thing went wrong
 * and nothing about which chat or how long to wait, so silencing the sentence too would leave a
 * script with a number and a person with nothing.
 *
 * The protocol note reaches `note` from the client (`commands/context.ts`), which is what makes
 * one rule cover it rather than two.
 */
const silence = (renderer: Renderer): Renderer => ({
  ...renderer,
  note: () => {},
  success: () => {},
  warn: () => {},
})
