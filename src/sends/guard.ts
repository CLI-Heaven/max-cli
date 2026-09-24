import { CliError } from "@leemour/cli-core"
import type { Id } from "../domain/models.js"
import type { AccountAction, ChatAction, SendEntry, SendJournal, SendKind } from "./journal.js"
import type { RecipientList } from "./recipients.js"

const HOUR_MS = 60 * 60 * 1000

/** What `MaxClient.messages.send` asks before it sends, and tells after — on every outcome. */
export interface SendGuard {
  /** `null` for a chat that does not exist yet — joining or creating one — or for the account itself: no list can name either. */
  check(chatId: Id | null, kind?: SendKind, action?: ChatAction, count?: number): void
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
 * What puts a new message in somebody's chat (`NEED-168`). A reaction, an edit, a quiet pin or a
 * change to a chat wakes nobody up; creating a group does — the people in it are told. A deletion
 * wakes nobody either, but many at once is what a ban for automation looks like, so each deleted
 * message counts as one (`MAX-47`).
 */
const countsTowardLimit = ({ kind = "message", action }: { kind?: SendKind; action?: ChatAction | AccountAction }) =>
  kind === "message" || kind === "forward" || kind === "delete" || action === "create"

const weightOf = (entry: SendEntry): number => (entry.kind === "delete" ? (entry.count ?? 1) : 1)

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
  check: (chatId, kind = "message", action, count = 1) => {
    if (readOnly) {
      throw new CliError(
        "permission_error",
        `profile ${profile} is read-only (readOnly, from the ${readOnlyFrom}) — it cannot send, react, change chats or change the account`,
      )
    }

    const allowed = recipients.read()
    if (chatId !== null && allowed && !allowed.some((chat) => chat.id === chatId)) {
      throw new CliError(
        "confirmation_required",
        `chat ${chatId} is not on the recipient list of profile ${profile} — ` +
          `the owner adds it with \`max ${profile} recipients add ${chatId}\``,
        { chatId },
      )
    }

    if (!countsTowardLimit({ kind, action })) return

    if (count > sendsPerHour) {
      throw new CliError(
        "rate_limited",
        `${count} at once is more than the hourly limit of profile ${profile} (sendsPerHour ${sendsPerHour}) — ` +
          "do fewer at a time",
      )
    }

    const since = now().getTime() - HOUR_MS
    const recent = journal
      .entries()
      .filter(countsTowardLimit)
      .filter((entry) => entry.outcome === "sent" || entry.outcome === "outcome_unknown")
      .map((entry) => ({ time: Date.parse(entry.at), weight: weightOf(entry) }))
      .filter(({ time }) => time > since)
      .sort((a, b) => a.time - b.time)
    const used = recent.reduce((sum, { weight }) => sum + weight, 0)
    if (used + count > sendsPerHour) {
      // The limit may have been lowered below what the last hour already holds: it opens when
      // enough of it has aged out, not when the oldest has.
      let freed = 0
      const opening = recent.find(({ weight }) => {
        freed += weight
        return used - freed + count <= sendsPerHour
      })
      const nextMs = (opening?.time ?? 0) + HOUR_MS
      const next = new Date(nextMs).toISOString()
      throw new CliError(
        "rate_limited",
        `profile ${profile} has sent ${used} messages in the last hour, and its limit is ` +
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
