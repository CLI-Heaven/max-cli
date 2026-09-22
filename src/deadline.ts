import { CliError } from "@leemour/cli-core"

/** Anything holding something that would keep the process alive. A `MaxClient` is one. */
export interface Closeable {
  close(): Promise<void>
}

/**
 * Stops the whole command at `ms`, and **closes what it was holding on the way out**.
 *
 * ⚠ The closing is the part that matters, and it is what a plain `Promise.race` does not do.
 * Racing only decides which answer is printed; the losing work carries on, and an open WebSocket
 * keeps Node alive — so a command that reported a timeout would then sit there, which is the
 * defect §18 forbids and worse than the wait it was cutting short. A test covers exactly that, by
 * taking the closing away and watching what is left behind.
 *
 * Closing a connection with a request still in flight used to strand the caller forever; it now
 * rejects it (`BUG-24`), which is what lets the body unwind through its own `finally` rather than
 * hanging somewhere underneath this.
 *
 * ⚠ **It bounds everything, not only what talks to MAX.** `max messages search` never opens a
 * socket at all and still has to fit the budget: an agent handing out thirty seconds does not
 * know which commands are the networked ones, and a bound that quietly did not apply to some of
 * them would be worse than no bound.
 *
 * It lives here rather than under `commands/` because it is about the lifetime of a process, not
 * about any command — and because a command may not reach the transport, while the thing that
 * shuts the transport down has to.
 *
 * Without a bound there is no timer and no race: the ordinary path is exactly what it was.
 */
export const withDeadline = async <T>(
  ms: number | undefined,
  closeables: Closeable[],
  body: () => Promise<T>,
): Promise<T> => {
  if (ms === undefined) return body()

  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Sockets first, then the message: the rejection is what the person reads, and the closing
      // is what lets the process actually end once they have read it.
      void Promise.allSettled(closeables.map((closeable) => closeable.close())).then(() =>
        reject(new CliError("timeout", `the command did not finish within ${ms}ms — \`--timeout\` ended it`)),
      )
    }, ms)
  })

  try {
    return await Promise.race([body(), expired])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
