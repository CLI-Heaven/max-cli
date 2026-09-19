/**
 * The second runtime, actually executed against the built command (NEED-11).
 *
 * The Vitest suite covers Node. Bun cannot run it, and a type check proves nothing about a runtime,
 * so this runs the real binary and checks what reached which stream.
 *
 *   pnpm build && bun run scripts/smoke.ts
 */
import { spawnSync } from "node:child_process"

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

if (failures.length > 0) {
  console.error(`max-cli smoke FAILED under ${runtime}:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`max-cli smoke passed under ${runtime}`)
