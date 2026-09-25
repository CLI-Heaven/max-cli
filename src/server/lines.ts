import { isInteger, isSafeNumber, parse, stringify } from "lossless-json"

/**
 * One JSON value per line, **losslessly**: a request or an answer passing through `max serve`
 * carries MAX's 18-digit message ids, which `JSON` would round into somebody else's message.
 *
 * **A `bigint` crosses as a `bigint`, however small.** It is how the codec tells an id from a
 * count — ids go to MAX wrapped in extension 1, as the web client sends them — and a plain number
 * literal would come back a `number` for any id that fits one.
 */
export const toLine = (value: unknown): string =>
  `${stringify(value, (_, item) => (typeof item === "bigint" ? { [BIGINT]: item.toString() } : item))}\n`

export const fromLine = (line: string): Record<string, unknown> =>
  parse(line, (_, item) => (isTagged(item) ? BigInt(item[BIGINT]) : item), {
    parseNumber: (text) => (isInteger(text) && !isSafeNumber(text) ? BigInt(text) : Number(text)),
  }) as Record<string, unknown>

const BIGINT = "$bigint"

const isTagged = (item: unknown): item is { [BIGINT]: string } =>
  typeof item === "object" &&
  item !== null &&
  Object.keys(item).length === 1 &&
  typeof (item as Record<string, unknown>)[BIGINT] === "string"

/**
 * Calls `onLine` for each complete line `data` finishes, keeping the rest for next time. With
 * `maxLength`, a line that grows past it calls `onTooLong` instead and nothing more is read.
 */
export const lineReader = (
  onLine: (line: string) => void,
  { maxLength = Number.POSITIVE_INFINITY, onTooLong = () => {} }: { maxLength?: number; onTooLong?: () => void } = {},
) => {
  let buffered = ""
  let stopped = false
  return (data: Buffer | string) => {
    if (stopped) return
    buffered += String(data)
    let end = buffered.indexOf("\n")
    while (end >= 0) {
      const line = buffered.slice(0, end)
      buffered = buffered.slice(end + 1)
      if (line.trim() !== "") onLine(line)
      end = buffered.indexOf("\n")
    }
    if (buffered.length > maxLength) {
      stopped = true
      buffered = ""
      onTooLong()
    }
  }
}
