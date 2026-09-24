import { CliError } from "@leemour/cli-core"
import type { Id } from "../domain/models.js"
import type { SendEntry, SendJournal, SendKind } from "./journal.js"
import type { RecipientList } from "./recipients.js"

const HOUR_MS = 60 * 60 * 1000

/** What puts a new message in somebody's chat. A reaction, an edit or a quiet pin wakes nobody up (`NEED-168`). */
const counted = (kind: SendKind = "message"): boolean => kind === "message" || kind === "forward"

/** What `MaxClient.messages.send` asks before it sends, and tells after — on every outcome. */
export interface SendGuard {
  check(chatId: Id, kind?: SendKind): void
  record(entry: Omit<SendEntry, "at" | "profile">): void
}

export interface SendGuardOptions {
  profile: string
  readOnly: boolean
  /** Named in the refusal, so the owner can find what decided it. */
  readOnlyFrom: string
  sendsPerHour: number
  journal: SendJournal
  recipients: RecipientList
  warn: (message: string) => void
  now?: () => Date
}

/**
 * These stop a model that was talked into sending by a message it read. They do **not** stop an
 * agent that edits the configuration itself — that needs a boundary outside this process
 * (`docs/security.md`).
 */
export const sendGuard = ({
  profile,
  readOnly,
  readOnlyFrom,
  sendsPerHour,
  journal,
  recipients,
  warn,
  now = () => new Date(),
}: SendGuardOptions): SendGuard => ({
  check: (chatId, kind = "message") => {
    if (readOnly) {
      throw new CliError(
        "permission_error",
        `profile ${profile} is read-only (readOnly, from the ${readOnlyFrom}) — it cannot send or react`,
      )
    }

    const allowed = recipients.read()
    if (allowed && !allowed.some((chat) => chat.id === chatId)) {
      throw new CliError(
        "confirmation_required",
        `chat ${chatId} is not on the recipient list of profile ${profile} — ` +
          `the owner adds it with \`max ${profile} recipients add ${chatId}\``,
        { chatId },
      )
    }

    if (!counted(kind)) return

    const since = now().getTime() - HOUR_MS
    const recent = journal
      .entries()
      .filter((entry) => counted(entry.kind))
      .filter((entry) => entry.outcome === "sent" || entry.outcome === "outcome_unknown")
      .map((entry) => Date.parse(entry.at))
      .filter((time) => time > since)
      .sort((a, b) => a - b)
    if (recent.length >= sendsPerHour) {
      // The limit may have been lowered below what the last hour already holds.
      const nextMs = (recent[recent.length - sendsPerHour] ?? 0) + HOUR_MS
      const next = new Date(nextMs).toISOString()
      throw new CliError(
        "rate_limited",
        `profile ${profile} has sent ${recent.length} messages in the last hour, and its limit is ` +
          `${sendsPerHour} (sendsPerHour) — the next send is possible at ${next}`,
        { retryAfterMs: nextMs - now().getTime(), retryAt: next },
      )
    }
  },

  // After a send, a failure to write here must not become the command's answer: the message is
  // already with a person, and an error would invite the caller to send it again.
  record: (entry) => {
    try {
      journal.append({ at: now().toISOString(), profile, ...entry })
    } catch (error) {
      warn(`this send is not in the send journal: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
})
