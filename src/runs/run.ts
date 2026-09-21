import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createFileLogger, type FileLogger, resolvePaths, writeSecurely } from "@leemour/cli-core"

export type RunStatus = "success" | "failed"

/**
 * What a run was, and how it ended. **It never says what was read or sent** — a command, a profile
 * and a count, and the `errorCode` a script branches on rather than the sentence a person reads,
 * because MAX's refusals quote the payload back at us.
 */
export interface RunMetadata {
  runId: string
  /** As typed, without the arguments: `chats list`, `messages send`. */
  command: string
  profile: string
  startedAt: string
  completedAt?: string
  status: RunStatus | "running"
  /** How many requests reached MAX. A read the cache answers makes none at all (`MAX-7`). */
  requests?: number
  durationMs?: number
  cliVersion: string
  errorCode?: string
}

export interface StartRunOptions {
  runsDir: string
  command: string
  profile: string
  cliVersion: string
  /** Older runs are removed as this one starts (`NEED-49`). */
  keepDays?: number
  runId?: string
  now?: () => Date
}

export interface Run {
  id: string
  dir: string
  logger: FileLogger
  /**
   * Writes the final `run.json` and closes the log. **Must run on every path** — the answer, a
   * refusal, a failure before the connection was even open. Safe to call twice.
   */
  finish(status: RunStatus, extra?: Partial<RunMetadata>): Promise<void>
}

/** 30 days (`NEED-49`). Time is what you think in when asking what you did last week. */
export const KEEP_RUNS_FOR_DAYS = 30

/**
 * `<state dir>/runs`. Beside the profiles and never in the cache directory: a cache is deleted to
 * fix a cache, and the log is the one thing here that cannot be rebuilt from MAX (`NEED-51`).
 */
export const runsDirFor = (env: NodeJS.ProcessEnv = process.env): string =>
  join(resolvePaths({ appName: "max-cli", prefix: "MAX", env }).state, "runs")

/**
 * Opens a run directory, the shape `braze-cli` arrived at
 * (`../braze-cli/packages/cli/src/runs/run.ts:74`).
 *
 * ```text
 * <state dir>/runs/2026-09-20/20260920T084431Z-chats-list-a81f2c/
 *   run.json       what it was, when, which profile, how long, the outcome
 *   events.jsonl   one JSON object per request, written by Pino, no ANSI ever
 * ```
 *
 * `run.json` is written **now**, with `status: "running"`, and again by `finish`. A directory
 * holding events and no metadata is a special case `max runs list` would carry forever.
 */
export const startRun = (options: StartRunOptions): Run => {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const id = options.runId ?? runId(startedAt, options.command)
  const dir = join(options.runsDir, day(startedAt), id)

  // Only while something is being recorded: a tool that is not recording has no business walking
  // that directory (`NEED-49`).
  pruneRuns(options.runsDir, { keepDays: options.keepDays ?? KEEP_RUNS_FOR_DAYS, now: startedAt })

  mkdirSync(dir, { recursive: true, mode: 0o700 })

  // Created here rather than by the logger, which opens with whatever the umask allows. The
  // directory is already 0700, so this is the second lock rather than the first — but a log file
  // that outlives its directory, or is copied out of it, should not be the one that is readable.
  const events = join(dir, "events.jsonl")
  writeFileSync(events, "", { flag: "a", mode: 0o600 })

  const logger = createFileLogger({
    path: events,
    base: { runId: id, command: options.command, profile: options.profile },
  })

  const metadata: RunMetadata = {
    runId: id,
    command: options.command,
    profile: options.profile,
    startedAt: startedAt.toISOString(),
    status: "running",
    cliVersion: options.cliVersion,
  }
  writeRunFile(dir, metadata)

  let finished = false

  return {
    id,
    dir,
    logger,
    finish: async (status, extra = {}) => {
      if (finished) return
      finished = true

      const completedAt = now()
      writeRunFile(dir, {
        ...metadata,
        ...extra,
        status,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      })

      // Pino writes through a plain append stream, and a process that exits before it flushes
      // loses the tail — which is exactly the run somebody wanted to read.
      await logger.close()
    },
  }
}

/** `20260920T084431Z-chats-list-a81f2c` — sortable, and readable without opening it. */
const runId = (startedAt: Date, command: string): string => {
  const stamp = startedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const slug = command.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  return `${stamp}-${slug}-${randomUUID().slice(0, 6)}`
}

const writeRunFile = (dir: string, metadata: RunMetadata): void => {
  // Atomic, so a reader never sees half of one — and 0600, because it names a profile and a
  // command even though it carries nothing of what was said.
  writeSecurely(join(dir, "run.json"), `${JSON.stringify(metadata, null, 2)}\n`, 0o600)
}

/** Newest first, which is the order anyone asking "what did I just do" wants. */
export const listRuns = (runsDir: string): RunMetadata[] => {
  const runs: RunMetadata[] = []

  for (const date of days(runsDir).sort().reverse()) {
    for (const entry of safeReaddir(join(runsDir, date)).sort().reverse()) {
      const metadata = readRun(join(runsDir, date, entry))
      if (metadata) runs.push(metadata)
    }
  }
  return runs
}

export const findRun = (runsDir: string, id: string): { dir: string; metadata: RunMetadata } | undefined => {
  for (const date of days(runsDir)) {
    const dir = join(runsDir, date, id)
    const metadata = readRun(dir)
    if (metadata) return { dir, metadata }
  }
  return undefined
}

/** The events of one run, in the order they happened. A line that will not parse is skipped. */
export const readEvents = (dir: string): Record<string, unknown>[] => {
  let raw: string
  try {
    raw = readFileSync(join(dir, "events.jsonl"), "utf8")
  } catch {
    return []
  }

  const events: Record<string, unknown>[] = []
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed !== null && typeof parsed === "object") events.push(parsed as Record<string, unknown>)
    } catch {
      // A half-written last line is what a killed process leaves behind. The rest of the file is
      // still the run somebody wants to read.
    }
  }
  return events
}

/**
 * Removes every day older than `keepDays`, and answers how many days went.
 *
 * A whole day at a time, by the directory name, so nothing has to be opened to decide — and a
 * directory that is not a date is left alone rather than guessed at.
 */
export const pruneRuns = (runsDir: string, { keepDays, now }: { keepDays: number; now: Date }): number => {
  const cutoff = day(new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000))

  let removed = 0
  for (const date of days(runsDir)) {
    if (date >= cutoff) continue
    try {
      rmSync(join(runsDir, date), { recursive: true, force: true })
      removed += 1
    } catch {
      // A day we cannot remove is not a reason to fail the command that was only starting.
    }
  }
  return removed
}

const day = (date: Date): string => date.toISOString().slice(0, 10)

const days = (runsDir: string): string[] => safeReaddir(runsDir).filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry))

const readRun = (dir: string): RunMetadata | undefined => {
  try {
    return JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunMetadata
  } catch {
    return undefined
  }
}

const safeReaddir = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
