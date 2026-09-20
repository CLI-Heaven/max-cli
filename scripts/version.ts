/**
 * Keeps `src/version.ts` in step with `package.json`, and fails when it is not.
 *
 *   node --experimental-strip-types scripts/version.ts          # check
 *   node --experimental-strip-types scripts/version.ts --sync   # write
 *
 * Two files hold the version because one of them is read at runtime — `max --version` must not
 * load `package.json`, which is not there once the command is bundled or run from `dist`. The
 * check exists because the day they disagree is a release day, and the wrong one is what a user
 * quotes back in a bug report.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const packagePath = join(root, "package.json")
const versionPath = join(root, "src/version.ts")

const declared = (JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown }).version
if (typeof declared !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(declared)) {
  console.error(`package.json has no usable "version" (got ${JSON.stringify(declared)})`)
  process.exit(2)
}

const source = readFileSync(versionPath, "utf8")
const found = /export const VERSION = "([^"]*)"/.exec(source)
if (!found?.[1]) {
  console.error(`src/version.ts does not export a VERSION string`)
  process.exit(2)
}

const current = found[1]

if (process.argv.includes("--sync")) {
  if (current === declared) {
    console.log(`version ${declared} — already in step`)
    process.exit(0)
  }
  writeFileSync(versionPath, source.replace(`"${current}"`, `"${declared}"`))
  console.log(`src/version.ts: ${current} → ${declared}`)
  process.exit(0)
}

if (current !== declared) {
  console.error(
    `version drift: package.json says ${declared}, src/version.ts says ${current}.\n` +
      `Run \`pnpm version:sync\` — package.json is the one that is edited.`,
  )
  process.exit(1)
}

console.log(`version ${declared} — package.json and src/version.ts agree`)
