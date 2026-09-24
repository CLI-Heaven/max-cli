import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolvePaths } from "@leemour/cli-core"
import type { Id } from "../domain/models.js"

export type SendOutcome = "sent" | "outcome_unknown" | "refused" | "failed"

/** Absent in the journal means a message: that is every line written before reactions were guarded. */
export type SendKind = "message" | "reaction"

/** One attempt to send. **Never the text** — only its length. */
export interface SendEntry {
  at: string
  profile: string
  chatId: Id
  outcome: SendOutcome
  kind?: SendKind
  messageId?: Id
  cid?: number
  length?: number
  errorCode?: string
}

/**
 * `<state dir>/sends/<profile>.jsonl` — beside `runs`, never in the cache directory, so that
 * `max cache clear` cannot erase what was sent in the owner's name (the reason of `NEED-51`).
 */
export const sendsPathFor = (profile: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(resolvePaths({ appName: "max-cli", prefix: "MAX", env }).state, "sends", `${profile}.jsonl`)

export class SendJournal {
  constructor(readonly path: string) {}

  append(entry: SendEntry): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  }

  /** Oldest first. A line that does not parse is skipped: a torn last write must not block sending. */
  entries(): SendEntry[] {
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
