/**
 * The second runtime, actually executed against the built command (NEED-11).
 *
 * The Vitest suite covers Node. Bun cannot run it, and a type check proves nothing about a runtime,
 * so this runs the real binary and checks what reached which stream.
 *
 *   pnpm build && bun run scripts/smoke.ts
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openCache } from "../dist/cache/open.js"

const runtime = typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? "node" : "bun"
const failures: string[] = []

const check = (what: string, condition: boolean) => {
  if (!condition) failures.push(what)
}

const max = (...args: string[]) => spawnSync(process.execPath, ["dist/bin/max.js", ...args], { encoding: "utf8" })

const version = max("--version")
check("--version exits cleanly", version.status === 0)
check("--version prints a version on stdout", /^\d+\.\d+\.\d+$/.test(version.stdout.trim()))
check("--version says nothing on stderr", version.stderr === "")

const help = max("--help")
check("--help names the command", help.stdout.includes("Usage: max"))

const bad = max("--nonsense")
check("an unknown option fails", bad.status !== 0)
check("an unknown option keeps stdout clean", bad.stdout === "")
check("an unknown option explains itself on stderr", bad.stderr.includes("unknown option"))

// The cache picks its SQLite by runtime, because node:sqlite and bun:sqlite are different modules
// (NEED-11). A type check cannot see that and the Vitest suite only ever runs one of the two, so
// the seam is only really proven here.
const database = await openCache(join(mkdtempSync(join(tmpdir(), "max-smoke-")), "cache.db"))
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

if (failures.length > 0) {
  console.error(`max-cli smoke FAILED under ${runtime}:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`max-cli smoke passed under ${runtime}`)
