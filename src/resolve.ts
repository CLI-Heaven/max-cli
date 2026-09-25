import { CliError, singleLine } from "@leemour/cli-core"
import type { CacheStore } from "./cache/store.js"
import type { Chat, Contact, Id } from "./domain/models.js"

export const isId = (reference: string): boolean => /^-?\d+$/.test(reference.trim())

/**
 * A name matched as a fragment — and **an ambiguous one is an error, not a guess**: sending to the
 * wrong conversation is not undoable, so the caller is shown the candidates and asked to be
 * specific. An exact title does not settle it while another title contains it too: a group named
 * "Мама" must not quietly take a send meant for "Мама Иванова".
 */
export const pickChat = (reference: string, chats: Chat[]): Chat => {
  const wanted = reference.trim().toLowerCase()
  const matches = chats.filter((chat) => chat.title?.toLowerCase().includes(wanted))

  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length === 0) throw new CliError("not_found", `no chat matches "${reference}"`)
  throw ambiguous(
    reference,
    "chats",
    matches.map((chat) => ({ id: chat.id, title: chat.title })),
    ({ title }) => singleLine(String(title)),
  )
}

/**
 * As `pickChat`, over names and @usernames. Matched here rather than in SQL because SQLite's
 * `lower()` folds ASCII only, and most of these names are Cyrillic.
 */
export const pickPerson = (reference: string, cache: CacheStore): Contact => {
  const trimmed = reference.trim()
  if (isId(trimmed)) {
    const known = cache.people.get(trimmed)
    if (!known) throw new CliError("not_found", `no person ${trimmed} in what this account has seen`)
    return known
  }

  const wanted = trimmed.replace(/^@/, "").toLowerCase()
  const everyone = cache.people.page({ order: "name", limit: Number.MAX_SAFE_INTEGER, offset: 0 })
  const fields = (person: Contact) => [person.name, person.username].filter(isPresent).map((one) => one.toLowerCase())

  const exact = everyone.filter((person) => fields(person).includes(wanted))
  const matches =
    exact.length > 0 ? exact : everyone.filter((person) => fields(person).some((one) => one.includes(wanted)))

  if (matches.length === 1 && matches[0]) return matches[0]
  if (matches.length === 0) throw new CliError("not_found", `nobody matches "${reference}"`)
  throw ambiguous(
    reference,
    "people",
    matches.map(({ id, name, username }) => ({ id, name, username })),
    ({ name, username }) => singleLine([name, username && `@${username}`].filter(isPresent).join("  ")),
  )
}

const ambiguous = <T extends { id: Id }>(
  reference: string,
  what: string,
  candidates: T[],
  label: (candidate: T) => string,
): CliError => {
  const width = Math.max(...candidates.map(({ id }) => id.length))
  const lines = candidates.map((candidate) => `  ${candidate.id.padEnd(width)}  ${label(candidate)}`).join("\n")
  return new CliError(
    "validation_error",
    `"${singleLine(reference)}" matches ${candidates.length} ${what} — name one by its id:\n${lines}`,
    { candidates },
  )
}

const isPresent = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined
