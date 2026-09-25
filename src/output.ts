import {
  createRenderer,
  processStreams,
  type Renderer,
  type RenderFormat,
  type Streams,
  singleLine,
} from "@leemour/cli-core"

export interface OutputOptions {
  json?: boolean
  jsonl?: boolean
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
 * JSON, because a pipe is a script until proven otherwise. `--jsonl` gives one JSON object per line
 * instead. In every machine mode **stdout carries JSON and nothing else** — diagnostics are on stderr in all modes, which is what makes
 * that contract hold by construction rather than by remembering.
 */
export const resolveOutput = ({ json, jsonl, quiet, streams = processStreams, tty, color }: OutputOptions = {}) => {
  const interactive = tty ?? process.stdout.isTTY === true
  const format: RenderFormat = jsonl ? "jsonl" : json || !interactive ? "json" : "pretty"
  const painted = color ?? (format === "pretty" && process.env.NO_COLOR === undefined)
  const created = createRenderer({ format, color: painted, streams })
  const renderer = format === "pretty" ? oneLineFields(created) : created

  return { format, color: painted, streams, renderer: quiet ? silence(renderer) : renderer }
}

/** Fields a person writes in paragraphs; every other string is a name, a title, an id or a path. */
const MULTI_LINE = new Set(["text", "description"])

/**
 * The pretty renderer keeps a newline inside a cell, which is right for a message and wrong for a
 * title: somebody else's chat title would print a row of its own. Machine output is left alone.
 */
const oneLineFields = (renderer: Renderer): Renderer => ({
  ...renderer,
  result: (value) => renderer.result(oneLine(value)),
  stream: (items) => renderer.stream([...items].map((item) => oneLine(item))),
})

const oneLine = (value: unknown, key?: string): unknown => {
  if (typeof value === "string") return key !== undefined && MULTI_LINE.has(key) ? value : singleLine(value)
  if (Array.isArray(value)) return value.map((item) => oneLine(item, key))
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, oneLine(item, field)]))
  }
  return value
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
