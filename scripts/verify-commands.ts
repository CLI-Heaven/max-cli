/**
 * Do the renamed commands still work against the real MAX? Run by hand, never by CI.
 *
 *   max session start                    # once, if there is no session yet
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
const binary = "dist/bin/max.js"

const run = (args: string[]) => spawnSync(process.execPath, [binary, ...args], { encoding: "utf8" })

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

const check = (label: string, args: string[]) => {
  const result = run([...args, "--json"])
  const problems: string[] = []

  if (result.status !== 0) problems.push(`exit ${result.status}`)
  if (result.stderr !== "") problems.push("wrote to stderr")

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
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
  console.error("no working session on this profile — run `max session start` first")
  console.error("(this script never logs in itself: a login it did not need is a login spent)")
  process.exit(2)
}

console.log("the renamed commands, against the real service — no content is printed:\n")

check("account show", ["account", "show"])
check("chats list", ["chats", "list", "--limit", "3"])
check("contacts list", ["contacts", "list", "--limit", "3"])
// Chat 0 is the owner's Saved-messages dialog: the one chat it is safe to touch without asking.
check("messages list", ["messages", "list", "0", "--limit", "3"])

if (process.argv.includes("--send-to-saved")) {
  // Chat 0 is the owner's Saved-messages dialog — the only chat a test may write to, and the
  // decision that made it so is NEED-28. It leaves a message he has to delete by hand (NEED-32),
  // which is why this needs asking for rather than being part of the run.
  console.log("\nsending one message to Saved messages — you will have to delete it yourself:")
  check("messages send", ["messages", "send", "0", "verify:live"])
} else {
  console.log("\nthe send path was NOT checked — pass --send-to-saved to include it")
}

console.log("\nand the shapes that must no longer exist:")
for (const gone of [["send", "0", "x"], ["me"], ["login"]]) {
  const result = run(gone)
  const refused = result.status !== 0 && result.stderr.includes("unknown command")
  console.log(`  ${refused ? "✓" : "✗"} max ${gone.join(" ")} — ${refused ? "refused" : "STILL ACCEPTED"}`)
  if (!refused) failures.push(`max ${gone.join(" ")} is still accepted`)
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log("\nall renamed commands answer, and none of the old spellings does")
