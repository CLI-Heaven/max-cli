import { createHash, randomBytes } from "node:crypto"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { CliError } from "@leemour/cli-core"
import type { Diagnosis } from "./diagnose.js"
import { findRun, listRuns, type RunMetadata, readEvents, runtime } from "./runs/run.js"
import type { SendEntry } from "./sends/journal.js"
import { VERSION } from "./version.js"

/** Where problem reports go (`NEED-267`, changed by the owner to issues). Anybody can read them there. */
export const REPORT_URL = "https://github.com/leemour/max-cli/issues/new"

const RECENT_SENDS = 20

export interface Report {
  createdAt: string
  version: string
  runtime: string
  platform: string
  arch: string
  profile: string
  doctor: Diagnosis
  /** The run the report is about: the one asked for, or the newest that failed. */
  run: { metadata: RunMetadata; events: Record<string, unknown>[] } | null
  /** The newest write actions — outcomes and ids, never text (`src/sends/journal.ts`). */
  sends: SendEntry[]
}

/**
 * **Everything a report holds is already free of content** — the run log and the send journal are
 * built that way. Two things are added: chat and message ids become labels, and the home directory
 * is hidden, since the doctor's paths name the person's account on this machine.
 */
export const buildReport = ({
  profile,
  doctor,
  runsDir,
  runId,
  sends,
  now = new Date(),
  home = homedir(),
}: {
  profile: string
  doctor: Diagnosis
  runsDir: string
  runId?: string
  sends: SendEntry[]
  now?: Date
  home?: string
}): Report => {
  const chosen = runId === undefined ? newestFailed(runsDir) : findRun(runsDir, runId)
  if (runId !== undefined && !chosen) throw new CliError("not_found", `no run ${runId} — \`max runs list\` names them`)

  const label = labeller()
  const labelled = labelledEvent(label)
  const report: Report = {
    createdAt: now.toISOString(),
    version: VERSION,
    runtime: runtime(),
    platform: process.platform,
    arch: process.arch,
    profile,
    doctor,
    run: chosen ? { metadata: chosen.metadata, events: readEvents(chosen.dir).map(labelled) } : null,
    sends: sends.slice(-RECENT_SENDS).map((entry) => ({
      ...entry,
      chatId: entry.chatId === null ? null : label(entry.chatId),
      ...(entry.messageId === undefined ? {} : { messageId: label(entry.messageId) }),
    })),
  }
  return JSON.parse(JSON.stringify(report).replaceAll(home, "~")) as Report
}

/**
 * The report is posted to a public issue, and a chat id is somebody's conversation with the owner.
 * Each id becomes a label that is the same everywhere in this report — so a failure can still be
 * followed from request to journal — and **a new salt per report**, so two reports cannot be joined.
 */
const labeller = () => {
  const salt = randomBytes(16)
  return (id: string): string => `id:${createHash("sha256").update(salt).update(id).digest("hex").slice(0, 12)}`
}

const labelledEvent =
  (label: (id: string) => string) =>
  (event: Record<string, unknown>): Record<string, unknown> => {
    const ids = event.ids
    if (typeof ids !== "object" || ids === null) return event
    const { chat, message, ...rest } = ids as Record<string, unknown>
    return {
      ...event,
      ids: {
        ...rest,
        ...(typeof chat === "string" ? { chat: label(chat) } : {}),
        ...(typeof message === "string" ? { message: label(message) } : {}),
      },
    }
  }

/**
 * A new issue with its title and body filled in, through GitHub's `title` and `body` query
 * parameters. The file cannot travel in a link; the person drags it in. **Only the file's name**
 * goes into the body — the issue is public, and a full path names the account on this machine.
 */
export const issueUrlFor = (report: Report, file: string): string => {
  const run = report.run?.metadata
  const subject = `max ${report.version}: ${run ? `${run.command} — ${run.errorCode ?? "failed"}` : "problem report"}`
  const body = [
    "Что я делал:",
    "",
    "Что ожидал:",
    "",
    "Что случилось:",
    "",
    "---",
    `max ${report.version}, ${report.runtime}, ${report.platform} ${report.arch}`,
    ...(run ? [`run ${run.runId}: ${run.errorCode ?? "failed"}${run.maxError ? ` (${run.maxError})` : ""}`] : []),
    `Файл отчёта: ${basename(file)}`,
  ].join("\n")
  return `${REPORT_URL}?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export const reportFileName = (now: Date): string =>
  `max-report-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}.json`

const newestFailed = (runsDir: string): { dir: string; metadata: RunMetadata } | undefined => {
  const failed = listRuns(runsDir).find((run) => run.status === "failed")
  return failed ? { dir: join(runsDir, failed.startedAt.slice(0, 10), failed.runId), metadata: failed } : undefined
}
