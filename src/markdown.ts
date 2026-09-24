/** One span of markup, in UTF-16 positions over the text as sent — which is what JavaScript counts. */
export interface Markup {
  type: string
  from: number
  length: number
}

const MARKERS: [string, string][] = [
  ["**", "STRONG"],
  ["~~", "STRIKETHROUGH"],
  ["`", "MONOSPACED"],
  ["_", "EMPHASIZED"],
  ["*", "EMPHASIZED"],
]

const WORD = /[\p{L}\p{N}]/u

/**
 * Markdown's inline marks, one level deep: the text inside a mark is kept as typed.
 *
 * ⚠ `_` and `*` open and close only at a word's edge, so `file_name_here` and `2*3*4` stay as they
 * are — the case where turning Markdown on would otherwise change a message nobody meant to format.
 * A backslash keeps the next character literal.
 */
export const parseMarkdown = (input: string): { text: string; markup: Markup[] } => {
  let text = ""
  const markup: Markup[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index] as string
    if (char === "\\" && index + 1 < input.length) {
      text += input[index + 1]
      index += 2
      continue
    }

    const found = MARKERS.find(([marker]) => input.startsWith(marker, index))
    const span = found && closing(input, index, found[0])
    if (found && span !== undefined) {
      const inner = input.slice(index + found[0].length, span)
      markup.push({ type: found[1], from: text.length, length: inner.length })
      text += inner
      index = span + found[0].length
      continue
    }

    text += char
    index += 1
  }
  return { text, markup }
}

const closing = (input: string, open: number, marker: string): number | undefined => {
  const start = open + marker.length
  const end = input.indexOf(marker, start)
  if (end <= start || input.slice(start, end).includes("\n")) return undefined
  if (marker === "_" || marker === "*") {
    if (WORD.test(input[open - 1] ?? "") || WORD.test(input[end + 1] ?? "")) return undefined
  }
  return end
}
