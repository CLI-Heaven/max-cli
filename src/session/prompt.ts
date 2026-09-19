import { createInterface } from "node:readline"
import { Writable } from "node:stream"

export interface SecretInput {
  input?: NodeJS.ReadableStream & { isTTY?: boolean }
  output?: NodeJS.WritableStream
}

/**
 * One line of secret, taken without a file and without argv.
 *
 * A token on a command line is read by `ps` and kept by shell history; a token in a file is a
 * second copy nobody remembers to delete. Both are avoided by never letting it land anywhere: it
 * is typed or piped, goes straight to the keyring, and is never echoed.
 *
 * The prompt goes to **stderr**, not stdout, so that `max login --json` still writes one JSON
 * value and nothing else.
 */
export const readSecret = async (
  prompt: string,
  { input = process.stdin, output = process.stderr }: SecretInput = {},
): Promise<string> => {
  if (!input.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of input) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString("utf8").trim()
  }

  let muted = false
  const shim = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) output.write(chunk)
      done()
    },
  })

  const reader = createInterface({ input, output: shim, terminal: true })
  try {
    const answer = await new Promise<string>((resolve) => {
      reader.question(prompt, resolve)
      muted = true
    })
    return answer.trim()
  } finally {
    reader.close()
    output.write("\n")
  }
}
