import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolvePaths } from "@leemour/cli-core"
import type { Id } from "../domain/models.js"

/** `reserved` holds a place under the hourly limit while the write is on its way; its outcome follows. */
export type SendOutcome = "sent" | "outcome_unknown" | "refused" | "failed" | "reserved"

/** Absent in the journal means a message: that is every line written before reactions were guarded. */
export type SendKind = "message" | "reaction" | "edit" | "forward" | "pin" | "read" | "delete" | "chat" | "account"

/** What a `chat` entry did. Never a title, a description or a link — only which action. */
export type ChatAction =
  | "create"
  | "join"
  | "leave"
  | "members.add"
  | "members.remove"
  | "admins.add"
  | "admins.remove"
  | "update"
  | "settings"
  | "requests.accept"
  | "requests.decline"
  | "link.reset"

/** What an `account` entry changed. Never the value it changed it to — no name, number or title. */
export type AccountAction =
  | "contact-add"
  | "contact-remove"
  | "contact-import"
  | "profile"
  | "folder-create"
  | "folder-update"
  | "folder-delete"
  | "sessions-end"

/** One attempt to send. **Never the text** — only its length. */
export interface SendEntry {
  at: string
  profile: string
  /** `null` when a join or a creation was refused before there was a chat, and for a change to the account itself. */
  chatId: Id | null
  outcome: SendOutcome
  kind?: SendKind
  action?: ChatAction | AccountAction
  /** How many people a `chat` entry added or removed. */
  people?: number
  messageId?: Id
  /** How many messages a `delete` entry named — each one counts toward the hourly limit. */
  count?: number
  forEveryone?: boolean
  cid?: number
  length?: number
  /** What was attached, by kind and size — never a file name. */
  attachments?: { kind: "photo" | "file"; bytes: number }[]
  /** When MAX will send it; it counts toward the limit of that hour, not of the hour it was queued. */
  scheduledFor?: string
  /** Whether a pin told the members. */
  notify?: boolean
  /** Pairs an outcome with the `reserved` line it settles. */
  reservation?: string
  errorCode?: string
}

/**
 * `<state dir>/sends/<profile>.jsonl` — beside `runs`, never in the cache directory, so that
 * `max cache clear` cannot erase what was sent in the owner's name (the reason of `NEED-51`).
 */
export const sendsPathFor = (profile: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(resolvePaths({ appName: "max-cli", prefix: "MAX", env }).state, "sends", `${profile}.jsonl`)

const LOCK_WAIT_MS = 5_000
/** Longer than any check and append takes; a lock this old was left by a process that died holding it. */
const LOCK_STALE_MS = 30_000
const pause = new Int32Array(new SharedArrayBuffer(4))

export class SendJournal {
  constructor(readonly path: string) {}

  /**
   * Runs `body` with the journal to itself, across processes: two sends at the limit must not both
   * read "one left". A lock file opened with `wx`, because `flock` is not there on Windows.
   */
  locked<T>(body: () => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const lock = `${this.path}.lock`
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      try {
        closeSync(openSync(lock, "wx", 0o600))
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        if (Date.now() - lockTime(lock) > LOCK_STALE_MS) {
          try {
            unlinkSync(lock)
          } catch {}
          continue
        }
        if (Date.now() > deadline)
          throw new Error(`the send journal stayed locked for ${LOCK_WAIT_MS / 1000}s (${lock})`)
        Atomics.wait(pause, 0, 0, 20)
      }
    }
    try {
      return body()
    } finally {
      try {
        unlinkSync(lock)
      } catch {}
    }
  }

  append(entry: SendEntry): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  }

  /**
   * Oldest first, each reservation folded into its outcome; one with no outcome yet is in flight,
   * or its process died. A line that does not parse is skipped: a torn last write must not block sending.
   */
  entries(): SendEntry[] {
    const lines = this.#lines()
    const settled = new Set(lines.filter((entry) => entry.outcome !== "reserved").map((entry) => entry.reservation))
    return lines
      .filter((entry) => entry.outcome !== "reserved" || !settled.has(entry.reservation))
      .map(({ reservation, ...entry }) => (entry.outcome === "reserved" ? { ...entry, reservation } : entry))
  }

  #lines(): SendEntry[] {
    let text: string
    try {
      text = readFileSync(this.path, "utf8")
    } catch {
      return []
    }
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as SendEntry]
        } catch {
          return []
        }
      })
  }
}

const lockTime = (lock: string): number => {
  try {
    return statSync(lock).mtimeMs
  } catch {
    return Date.now()
  }
}
