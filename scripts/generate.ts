/**
 * The specification in `src/spec/` is the source of truth; this writes down what follows from it.
 *
 *   pnpm generate
 *
 * Boring on purpose (`REQUIREMENTS.md` §28): read the registry, normalize it once, hand the model
 * to small emitters that only build strings, then write everything in a single pass. No emitter
 * touches the filesystem, so what is generated can be reasoned about without tracing writes.
 *
 * **The banner carries no date and no version.** CI regenerates and asserts the tree did not
 * change; anything that moves on its own turns that check into a permanent failure.
 *
 * It imports from `dist/` because Node's type stripping will not resolve a `.js` specifier to a
 * `.ts` file, so `pnpm generate` builds first.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Entry, Operation, Reservation } from "../dist/spec/define.js"
import { spec } from "../dist/spec/index.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

interface Row {
  entry: Entry
  group: string
  method: string
  /** The exported name in `src/spec/operations/<group>.ts`, by convention rather than by hand. */
  binding: string
}

/**
 * ⚠ **The annotation is on the binding, not on the arrow**, and it has to be: a `never`-returning
 * call only narrows what follows it when the declaration itself is typed. Written the other way
 * round, the two checks below are dead weight and `group` stays `string | undefined`.
 */
const fail: (message: string) => never = (message) => {
  throw new Error(`the specification cannot be generated from: ${message}`)
}

const normalize = (entries: readonly Entry[]): Row[] => {
  const seen = { opcode: new Map<number, string>(), name: new Set<string>(), constant: new Set<string>() }

  return entries.map((entry) => {
    const taken = seen.opcode.get(entry.opcode)
    if (taken) fail(`opcode ${entry.opcode} is claimed by both ${taken} and ${entry.name}`)
    if (seen.name.has(entry.name)) fail(`two entries are called ${entry.name}`)
    if (seen.constant.has(entry.constant)) fail(`two entries share the constant ${entry.constant}`)
    seen.opcode.set(entry.opcode, entry.name)
    seen.name.add(entry.name)
    seen.constant.add(entry.constant)

    const [group, method, ...rest] = entry.name.split(".")
    if (!group || !method || rest.length > 0) fail(`${entry.name} is not <group>.<method>`)

    return { entry, group, method, binding: `${group}${method[0]?.toUpperCase()}${method.slice(1)}` }
  })
}

const isOperation = (row: Row): row is Row & { entry: Operation } => row.entry.kind === "operation"
const isReservation = (row: Row): row is Row & { entry: Reservation } => row.entry.kind === "reservation"

const BANNER = `// Generated from src/spec/ by scripts/generate.ts. Do not edit; run \`pnpm generate\`.`

/** Wraps a generated comment, because the formatter does not reflow comments and these are long. */
const wrap = (text: string, indent: string, width = 118): string => {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line && `${indent} * ${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.map((each) => `${indent} * ${each}`).join("\n")
}

const opcodes = (rows: Row[]): string => {
  // Ascending, not in specification order: this is a numeric registry and that is how one is read.
  const lines = [...rows]
    .sort((a, b) => a.entry.opcode - b.entry.opcode)
    .map(({ entry }) => {
      const note =
        entry.kind === "reservation" ? `\n  /**\n${wrap(`**Declared, never sent.** ${entry.reason}`, "  ")}\n   */` : ""
      return `${note}\n  ${entry.constant}: ${entry.opcode},`
    })

  return `${BANNER}

/**
 * Every opcode this project knows. **A number being here is not permission to send it** — the ones
 * marked "declared, never sent" exist so the reason they are never sent has a home, and so a test
 * asserting their absence has something real to compare against.
 */
export const Opcode = {${lines.join("")}
} as const

export type Opcode = (typeof Opcode)[keyof typeof Opcode]
`
}

const operations = (rows: Row[]): string => {
  const wanted = rows.filter(isOperation)
  const imports = [...new Set(wanted.map((row) => row.group))]
    .map(
      (group) =>
        `import { ${wanted
          .filter((row) => row.group === group)
          .map((row) => row.binding)
          .join(", ")} } from "../spec/operations/${group}.js"`,
    )
    .join("\n")

  const entries = wanted.map((row) => `  "${row.entry.name}": ${row.binding},`).join("\n")

  return `${BANNER}
${imports}

/** Every operation that may be sent, by the name the client calls it. */
export const OPERATIONS = {
${entries}
} as const

export type OperationName = keyof typeof OPERATIONS
`
}

const client = (rows: Row[]): string => {
  const wanted = rows.filter(isOperation)
  const groups = [...new Set(wanted.map((row) => row.group))]

  const body = groups
    .map((group) => {
      const methods = wanted
        .filter((row) => row.group === group)
        .map(
          (row) =>
            `    ${row.method}: (request: RequestOf<typeof OPERATIONS["${row.entry.name}"]>) =>\n      invoke(OPERATIONS["${row.entry.name}"], request),`,
        )
        .join("\n")
      return `  ${group}: {\n${methods}\n  },`
    })
    .join("\n")

  return `${BANNER}
import type { Payload } from "../protocol/frame.js"
import type { Operation, RequestOf } from "../spec/define.js"
import { OPERATIONS } from "./operations.generated.js"

export type Invoke = <TOperation extends Operation>(
  operation: TOperation,
  request: RequestOf<TOperation>,
) => Promise<Payload>

/**
 * The wire surface: one typed call per operation, and nothing else.
 *
 * **It is internal.** Everything it returns is a raw MAX payload, with none of the rules that make
 * this tool safe to point at a real account — the resend policy, the name filling, the conversion
 * that keeps a 64-bit id from being read as a number. \`MaxClient\` is the only public door
 * (\`NEED-34\`).
 */
export const wireClient = (invoke: Invoke) => ({
${body}
})

export type WireClient = ReturnType<typeof wireClient>
`
}

const reference = (rows: Row[]): string => {
  const row = ({ entry }: Row) =>
    `| \`${entry.name}\` | ${entry.opcode} | \`${entry.constant}\` | ${
      entry.kind === "operation" ? (entry.auth ? "after login" : "before login") : "**never sent**"
    } | ${entry.provenance.confidence} | ${entry.provenance.sources.join("; ")} |`

  const notes = rows
    .filter(isReservation)
    .map(({ entry }) => `- **${entry.constant}** (${entry.opcode}) — ${entry.reason}`)
    .join("\n")

  return `${BANNER.replace("//", "<!--")} -->

# The MAX operations this project knows

Generated from \`src/spec/\`. Every shape here was written down once, in TypeScript, and the
validators, the opcode registry and this page all come from that one place.

**Confidence** says what the shape rests on. \`measured\` means we sent it and read the answer;
\`confirmed\` means two independent implementations agree and we have not run it; \`observed\`
means one does; \`inferred\` means it follows from something next to it; \`unknown\` means the
sources disagree.

| Operation | Opcode | MAX's name | When | Confidence | Where it came from |
|---|---|---|---|---|---|
${rows.map(row).join("\n")}

## The numbers that are declared and never sent

A number in the registry is not permission to use it.

${notes}
`
}

const rows = normalize(spec)

const files = [
  { path: "src/generated/opcodes.generated.ts", contents: opcodes(rows) },
  { path: "src/generated/operations.generated.ts", contents: operations(rows) },
  { path: "src/generated/client.generated.ts", contents: client(rows) },
  { path: "docs/protocol.md", contents: reference(rows) },
]

for (const file of files) {
  const full = join(root, file.path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, file.contents)
}

// Formatting happens here rather than being left to the linter: `pnpm generate` and `pnpm lint`
// disagreeing is what turns the staleness check in CI into a permanent failure.
execFileSync("pnpm", ["exec", "biome", "check", "--write", "--no-errors-on-unmatched", ...files.map((f) => f.path)], {
  cwd: root,
  stdio: "ignore",
  // pnpm is a .cmd script on Windows, which only a shell starts.
  shell: process.platform === "win32",
})

console.log(`generated ${files.length} files from ${rows.length} entries`)
