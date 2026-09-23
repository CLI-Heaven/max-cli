/**
 * Do the renamed commands still work against the real MAX? Run by hand, never by CI.
 *
 *   bin/max session start                # once per worktree, if there is no session yet
 *   pnpm verify:live                     # reads only
 *   pnpm verify:live --send-to-saved     # also sends one message to Saved messages
 *
 * **Read-only unless asked, and it prints no content.** Nothing sends and nothing marks anything
 * read, unless `--send-to-saved` is passed — a flag long enough that it cannot be typed by
 * accident. What reaches the screen is a pass or a fail, the number of items, and the field names
 * of our own domain model — never a chat title, a name, a message or an id.
 *
 * It exists because a rename is exactly where a wiring mistake hides: a subcommand that parses
 * perfectly and never reaches the socket looks identical to a working one until it is run.
 *
 * It imports nothing from `src/`: it drives the built binary the way a person does, which is the
 * only way to catch a fault in the argument parsing itself.
 */
import { spawnSync } from "node:child_process"

const failures: string[] = []
// Through bin/max, so a branch's build never opens and migrates the owner's real cache.
const run = (args: string[]) => spawnSync("bin/max", args, { encoding: "utf8" })

/** Field names of our own model are safe to show — they are in the documents. Values never are. */
const shapeOf = (value: unknown): string => {
  if (Array.isArray(value)) {
    const first = value[0]
    const keys = first && typeof first === "object" ? Object.keys(first).join(", ") : "—"
    return `${value.length} item(s), fields: ${keys}`
  }
  if (value && typeof value === "object") return `object, fields: ${Object.keys(value).join(", ")}`
  return typeof value
}

/**
 * ⚠ **The one thing standing between "converted" and "looks converted".**
 *
 * Without it a listing command that was never given the envelope passes green: an array parses as
 * JSON exactly as well as an object does, so exit 0 and valid JSON say nothing about the shape.
 * A listing must answer `{ items, page, limit, hasMore }`.
 */
const envelopeProblems = (parsed: unknown): string[] => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return ["a listing must answer one object, not an array"]
  }

  const envelope = parsed as Record<string, unknown>
  const problems: string[] = []
  if (!Array.isArray(envelope.items)) problems.push("`items` is not an array")
  if (typeof envelope.hasMore !== "boolean") problems.push("`hasMore` is not a boolean")
  if (typeof envelope.page !== "number") problems.push("`page` is not a number")
  if (typeof envelope.limit !== "number") problems.push("`limit` is not a number")
  return problems
}

const check = (label: string, args: string[], { listing = false } = {}) => {
  const result = run([...args, "--json"])
  const problems: string[] = []

  if (result.status !== 0) problems.push(`exit ${result.status}`)
  if (result.stderr !== "") problems.push("wrote to stderr")

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
    if (listing) problems.push(...envelopeProblems(parsed))
  } catch {
    problems.push("stdout is not one JSON value")
  }

  if (problems.length > 0) {
    failures.push(`${label}: ${problems.join("; ")}`)
    console.error(`  ✗ max ${args.join(" ")} — ${problems.join("; ")}`)
    return
  }

  console.log(`  ✓ max ${args.join(" ")} — ${shapeOf(parsed)}`)
}

const session = run(["account", "show", "--json"])
if (session.status !== 0) {
  console.error("no working session on this profile — run `bin/max session start` first")
  console.error("(this script never logs in itself: a login it did not need is a login spent)")
  process.exit(2)
}

console.log("the renamed commands, against the real service — no content is printed:\n")

check("account show", ["account", "show"])
check("chats list", ["chats", "list", "--limit", "3"], { listing: true })
check("contacts list", ["contacts", "list", "--limit", "3"], { listing: true })
check("contacts list --page 2", ["contacts", "list", "--limit", "2", "--page", "2"], { listing: true })
check("contacts list --all", ["contacts", "list", "--all"], { listing: true })
check("contacts list --order name", ["contacts", "list", "--limit", "3", "--order", "name"], { listing: true })
// Chat 0 is the owner's Saved-messages dialog: the one chat it is safe to touch without asking.
check("messages list", ["messages", "list", "0", "--limit", "3"], { listing: true })

// The second run of the same listing receives a near-empty delta. Anything rendering the response
// instead of the store answers emptily here and nowhere else, which no offline test can catch.
check("chats list, again", ["chats", "list", "--limit", "3"], { listing: true })

if (process.argv.includes("--send-to-saved")) {
  // Chat 0 is the owner's Saved-messages dialog — the only chat a test may write to, and the
  // decision that made it so is NEED-28. It leaves a message he has to delete by hand (NEED-32),
  // which is why this needs asking for rather than being part of the run.
  console.log("\nsending one message to Saved messages — you will have to delete it yourself:")
  check("messages send", ["messages", "send", "0", "verify:live"])
} else {
  console.log("\nthe send path was NOT checked — pass --send-to-saved to include it")
}

// An old spelling is now read as a profile name — `max me` is the profile `me` with no command —
// so what has to hold is not one particular sentence but that it fails, says why on stderr, and
// leaves stdout empty. Help printed on stdout would be a refusal a script cannot tell from data.
console.log("\nand the shapes that must no longer exist:")
for (const gone of [["send", "0", "x"], ["me"], ["login"], ["contacts", "list", "--all", "--page", "2"]]) {
  const result = run(gone)
  const refused = result.status !== 0 && result.stdout === "" && result.stderr !== ""
  console.log(`  ${refused ? "✓" : "✗"} max ${gone.join(" ")} — ${refused ? "refused" : "STILL ACCEPTED"}`)
  if (!refused) failures.push(`max ${gone.join(" ")} is still accepted`)
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log("\nall renamed commands answer, and none of the old spellings does")
