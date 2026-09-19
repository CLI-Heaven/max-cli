#!/usr/bin/env node
import { run } from "../program.js"

// `max chats --json | head` closes the pipe while we are still writing, and an unhandled EPIPE
// makes Node print a stack trace over the output of the command that just worked. A reader that
// stopped reading is not an error: leave quietly, as every other Unix tool does.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0)
    throw error
  })
}

process.exitCode = await run(process.argv.slice(2))
