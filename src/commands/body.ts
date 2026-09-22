import { CliError } from "@leemour/cli-core"

export interface BodyInput {
  input?: NodeJS.ReadableStream & { isTTY?: boolean }
}

/**
 * A message body, taken from a pipe instead of from argv.
 *
 * **argv is the wrong place for a message.** It is read by `ps` while the command runs and kept by
 * shell history afterwards — the two things this project forbids for the token, two lines away in
 * `session start` — and a body with a newline in it cannot be written there at all. The other CLI
 * this was compared against carries the same wound and works around it with a helper script.
 *
 * **Omitting the argument is the signal**, rather than a `--stdin` flag: `session start` in this
 * same repository already reads a piped token that way, and two spellings of one thing is what
 * `--profile` was deleted for.
 *
 * ⚠ **A terminal is refused, never prompted.** Reading from an interactive stdin would leave
 * `max messages send 0` — a forgotten argument — sitting there looking like it had hung, and a
 * command that does not return is a defect here rather than a rough edge (REQUIREMENTS §18).
 */
export const readBody = async ({ input = process.stdin }: BodyInput = {}): Promise<string> => {
  if (input.isTTY) {
    throw new CliError(
      "validation_error",
      "no message given — write it as the last argument, or pipe it in: `echo hi | max messages send <chat>`",
    )
  }

  const chunks: Buffer[] = []
  for await (const chunk of input) chunks.push(Buffer.from(chunk))

  // One trailing newline goes, and nothing else. `echo` and a heredoc both add one, so keeping it
  // would put a blank line at the end of most messages; trimming further would eat indentation and
  // deliberate blank lines, which in a message body are content rather than whitespace.
  const body = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "")

  if (body === "") {
    throw new CliError("validation_error", "the message body was empty — nothing was sent")
  }

  return body
}
