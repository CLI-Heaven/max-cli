/**
 * The second runtime, actually executed against the built command (NEED-11).
 *
 * The Vitest suite covers Node. Bun cannot run it, and a type check proves nothing about a runtime,
 * so this runs the real binary and checks what reached which stream.
 *
 *   pnpm build && bun run scripts/smoke.ts
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openCache } from "../dist/cache/open.js"

const runtime = typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? "node" : "bun"
const failures: string[] = []

const check = (what: string, condition: boolean) => {
  if (!condition) failures.push(what)
}

const max = (...args: string[]) => spawnSync(process.execPath, ["dist/bin/max.js", ...args], { encoding: "utf8" })

/**
 * The same command against directories of its own.
 *
 * Every check below writes something, and none of it may land in the owner's real state directory
 * — the overrides also move the keyring entry to a service of this directory's own, so nothing
 * here can read or delete the real session (`cli-core`, `pathsAreOverridden`).
 */
const isolated = mkdtempSync(join(tmpdir(), "max-smoke-run-"))
const maxHere = (...args: string[]) =>
  spawnSync(process.execPath, ["dist/bin/max.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      MAX_CONFIG_DIR: join(isolated, "config"),
      MAX_STATE_DIR: join(isolated, "state"),
      MAX_CACHE_DIR: join(isolated, "cache"),
    },
  })

const version = max("--version")
check("--version exits cleanly", version.status === 0)
check("--version prints a version on stdout", /^\d+\.\d+\.\d+$/.test(version.stdout.trim()))
check("--version says nothing on stderr", version.stderr === "")

const skill = max("skill", "show")
check(
  "skill show prints the SKILL.md the package ships",
  skill.status === 0 && skill.stdout.startsWith("---\nname: max-cli"),
)

const help = max("--help")
check("--help names the command", help.stdout.includes("Usage: max"))

const bad = max("--nonsense")
check("an unknown option fails", bad.status !== 0)
check("an unknown option keeps stdout clean", bad.stdout === "")
check("an unknown option explains itself on stderr", bad.stderr.includes("unknown option"))

// Nothing has been recorded, and an empty answer that does not say why reads as broken (NEED-52).
// The explanation is a diagnostic, so stdout still carries one JSON value and nothing else.
const empty = maxHere("runs", "list", "--json")
check("`runs list` exits cleanly with nothing to show", empty.status === 0)
check("`runs list` prints an empty list on stdout", empty.stdout.trim() === "[]")
check("`runs list` says on stderr why it is empty", empty.stderr.includes("--record"))

// Pino writes the event log, and this is the only place it runs under Bun. `session end` reaches
// no network and, in this directory, no real session — what it proves is that the run directory,
// the atomic `run.json` and the log stream all work under this runtime.
const recordedRun = maxHere("session", "end", "--record", "--json")
check("a recorded command exits cleanly", recordedRun.status === 0)
check("a recorded command still prints its own answer", JSON.parse(recordedRun.stdout).forgotten === false)

const days = readdirSync(join(isolated, "state", "runs"))
const day = days[0] ?? ""
const kept = readdirSync(join(isolated, "state", "runs", day))
const runDir = join(isolated, "state", "runs", day, kept[0] ?? "")
check("it left exactly one run directory", days.length === 1 && kept.length === 1)
check("the run directory holds its metadata", existsSync(join(runDir, "run.json")))
check("the run directory holds its event log", existsSync(join(runDir, "events.jsonl")))

const listed = maxHere("runs", "list", "--json")
check("`runs list` finds the run that was just kept", JSON.parse(listed.stdout)[0]?.status === "success")

const path = maxHere("runs", "path", kept[0] ?? "", "--json")
check("`runs path` answers with the directory, as one JSON value", JSON.parse(path.stdout).path === runDir)

const shown = maxHere("runs", "show", kept[0] ?? "", "--json")
check("`runs show` answers with the run and its events", JSON.parse(shown.stdout).runId === kept[0])
check("`runs show` refuses an id it does not have", maxHere("runs", "show", "no-such-run").status !== 0)

// The cache picks its SQLite by runtime, because node:sqlite and bun:sqlite are different modules
// (NEED-11). A type check cannot see that and the Vitest suite only ever runs one of the two, so
// the seam is only really proven here.
const database = await openCache(join(isolated, "smoke.db"))
try {
  check("the cache opens under this runtime", true)
  check(
    "it is in write-ahead mode",
    (database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string })?.journal_mode === "wal",
  )

  database.exec("CREATE TABLE t (a TEXT PRIMARY KEY, b INTEGER)")
  check(
    "a write reports how many rows it changed",
    database.prepare("INSERT INTO t VALUES (?, ?)").run("x", 1).changes === 1,
  )
  check(
    "a read gives the value back",
    (database.prepare("SELECT b FROM t WHERE a = ?").get("x") as { b?: number })?.b === 1,
  )
  check(
    "a conflicting write changes nothing",
    database.prepare("INSERT INTO t VALUES (?, ?) ON CONFLICT(a) DO NOTHING").run("x", 2).changes === 0,
  )
} finally {
  database.close()
}

rmSync(isolated, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`max-cli smoke FAILED under ${runtime}:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`max-cli smoke passed under ${runtime}`)
