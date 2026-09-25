import { BACKUP_PAGE } from "./client.js"
import { heldWindows, type Unread, unreadStretches, type Window } from "./export.js"

export interface BackupEstimate {
  held: number
  unread: Unread[]
  reachedStart: boolean
  missing: number | null
  estimated: boolean
  pages: number | null
  runs: number | null
  minutes: number | null
}

/**
 * **What a backup would cost, from the local copy alone** — no login, no request.
 *
 * `--last` is counted: what the cache holds unbroken from the newest message down. `--since` has no
 * count to go on (MAX sends `messagesCount` for groups and channels only, and it is not kept), so
 * the unread stretches are priced at the density of what was read — an estimate, and marked one.
 */
export const estimateBackup = ({
  ranges,
  count,
  newest,
  since,
  last,
  maxPages,
  pauseSeconds,
}: {
  ranges: Window[]
  count: (since: number) => number
  newest: number
  since?: number
  last?: number
  maxPages: number
  pauseSeconds: number
}): BackupEstimate => {
  const windows = heldWindows(ranges)
  const reachedStart = windows[0]?.from === 0
  const top = windows.at(-1)

  let held: number
  let unread: Unread[] = []
  let missing: number | null
  let estimated = false

  if (last !== undefined) {
    const unbroken = top && top.to >= newest ? count(top.from) : 0
    held = Math.min(last, unbroken)
    missing = top?.from === 0 && top.to >= newest ? 0 : last - held
  } else {
    const from = since ?? 0
    held = count(from)
    unread =
      windows.length === 0
        ? [{ from: new Date(from).toISOString(), to: new Date(newest).toISOString() }]
        : unreadStretches(ranges, { since: from, last: newest })
    const gap = unread.reduce(
      (sum, { from: start, to }) => sum + Date.parse(to) - (start ? Date.parse(start) : from),
      0,
    )
    const covered = windows.reduce(
      (sum, window) => sum + Math.max(0, Math.min(window.to, newest) - Math.max(window.from, from)),
      0,
    )
    estimated = gap > 0
    missing = gap === 0 ? 0 : held > 0 && covered > 0 ? Math.round((held / covered) * gap) : null
  }

  const pages = missing === null ? null : Math.max(1, Math.ceil(missing / (BACKUP_PAGE - 1)))
  return {
    held,
    unread,
    reachedStart,
    missing,
    estimated,
    pages,
    runs: pages === null ? null : Math.ceil(pages / maxPages),
    minutes: pages === null ? null : Math.round(((pages - 1) * pauseSeconds * 1.5) / 6) / 10,
  }
}
