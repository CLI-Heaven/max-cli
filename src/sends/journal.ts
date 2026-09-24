import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolvePaths } from "@leemour/cli-core"
import type { Id } from "../domain/models.js"

export type SendOutcome = "sent" | "outcome_unknown" | "refused" | "failed"

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
  /** When MAX will send it; the entry is written when it was queued, and the guard counted it then. */
  scheduledFor?: string
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
