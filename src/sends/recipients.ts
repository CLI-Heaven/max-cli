import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { CliError, resolvePaths, writeSecurely } from "@leemour/cli-core"
import type { Id } from "../domain/models.js"

export interface Recipient {
  id: Id
  title: string | null
  /** The other person, for a one-to-one chat: who may be put in a group when the list is on. */
  partnerId?: Id
  addedAt: string
}

/**
 * A state file, not a setting: the configuration schema has deliberately no place for a chat id
 * (`src/config.ts`), and this list is data about a profile rather than a preference.
 */
export const recipientsPathFor = (profile: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(resolvePaths({ appName: "max-cli", prefix: "MAX", env }).state, "profiles", `${profile}.recipients.json`)

/**
 * The chats a profile may send to. **No file means the check is off**; a file with no chats in it
 * means nowhere. Optional by the owner's ruling (`NEED-159`).
 */
export class RecipientList {
  constructor(readonly path: string) {}

  /** `undefined` when the list is off. A file that cannot be read refuses rather than opening up. */
  read(): Recipient[] | undefined {
    if (!existsSync(this.path)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { chats?: unknown }
      if (!Array.isArray(parsed.chats)) throw new Error("no `chats` array")
      return parsed.chats as Recipient[]
    } catch (error) {
      throw new CliError(
        "configuration_error",
        `the recipient list ${this.path} cannot be read (${error instanceof Error ? error.message : String(error)}) — ` +
          "fix the file or turn the list off with `max recipients off`",
      )
    }
  }

  /** Whether it was new. Adding one again fills in a partner an older entry was stored without. */
  add(recipient: Recipient): boolean {
    const chats = this.read() ?? []
    const known = chats.find((chat) => chat.id === recipient.id)
    if (known) {
      if (recipient.partnerId && !known.partnerId) {
        this.#write(chats.map((chat) => (chat === known ? { ...known, partnerId: recipient.partnerId } : chat)))
      }
      return false
    }
    this.#write([...chats, recipient])
    return true
  }

  /** The id or the title as it was stored; `undefined` when neither matched. */
  remove(reference: string): Recipient | undefined {
    const chats = this.read() ?? []
    const wanted = reference.trim()
    const gone =
      chats.find((chat) => chat.id === wanted) ??
      chats.find((chat) => chat.title?.toLocaleLowerCase() === wanted.toLocaleLowerCase())
    if (gone) this.#write(chats.filter((chat) => chat !== gone))
    return gone
  }

  /** Whether there was a list to turn off. */
  off(): boolean {
    if (!existsSync(this.path)) return false
    rmSync(this.path)
    return true
  }

  #write(chats: Recipient[]): void {
    writeSecurely(this.path, `${JSON.stringify({ chats }, null, 2)}\n`, 0o600)
  }
}
