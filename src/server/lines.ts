import { isInteger, isSafeNumber, parse, stringify } from "lossless-json"

/**
 * One JSON value per line, **losslessly**: a request or an answer passing through `max serve`
 * carries MAX's 18-digit message ids, which `JSON` would round into somebody else's message.
 */
export const toLine = (value: unknown): string => `${stringify(value)}\n`

export const fromLine = (line: string): Record<string, unknown> =>
  parse(line, undefined, {
    parseNumber: (text) => (isInteger(text) && !isSafeNumber(text) ? BigInt(text) : Number(text)),
  }) as Record<string, unknown>

/** Calls `onLine` for each complete line `data` finishes, keeping the rest for next time. */
export const lineReader = (onLine: (line: string) => void) => {
  let buffered = ""
  return (data: Buffer | string) => {
    buffered += String(data)
    let end = buffered.indexOf("\n")
    while (end >= 0) {
      const line = buffered.slice(0, end)
      buffered = buffered.slice(end + 1)
      if (line.trim() !== "") onLine(line)
      end = buffered.indexOf("\n")
    }
  }
}
