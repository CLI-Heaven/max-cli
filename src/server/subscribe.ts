import { connect } from "node:net"
import { CliError } from "@leemour/cli-core"
import { asFirstWord } from "../profile.js"
import type { ServerEvent } from "./server.js"

/**
 * Listens to a running `max serve` until it goes away or `signal` fires.
 *
 * No server is an error that names the command to start one — starting it silently would leave a
 * long-lived connection nobody asked for.
 */
export const subscribe = (
  path: string,
  profile: string,
  onEvent: (event: ServerEvent) => void,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = connect(path)
    let buffered = ""

    signal?.addEventListener("abort", () => socket.end(), { once: true })
    socket.once("connect", () => socket.write(`${JSON.stringify({ subscribe: true })}\n`))
    socket.on("data", (data) => {
      buffered += String(data)
      let end = buffered.indexOf("\n")
      while (end >= 0) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 1)
        if (line.trim() !== "") onEvent(JSON.parse(line) as ServerEvent)
        end = buffered.indexOf("\n")
      }
    })
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        const command = `max ${asFirstWord(profile)}serve`
        reject(
          new CliError("not_found", `no server is running for profile "${profile}" — start one with \`${command}\``),
        )
      } else reject(error)
    })
    socket.once("close", () => resolve())
  })
