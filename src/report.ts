import { homedir } from "node:os"
import { join } from "node:path"
import { CliError } from "@leemour/cli-core"
import type { Diagnosis } from "./diagnose.js"
import { findRun, listRuns, type RunMetadata, readEvents, runtime } from "./runs/run.js"
import type { SendEntry } from "./sends/journal.js"
import { VERSION } from "./version.js"

/** Where problem reports go (`NEED-267`). There is no server of ours: the person's mail program sends it. */
export const REPORT_ADDRESS = "reports@neirox.ai"

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
 * built that way — so nothing here filters. The one thing added is hiding the home directory: the
 * doctor's paths name the person's account on this machine.
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

  const report: Report = {
    createdAt: now.toISOString(),
    version: VERSION,
    runtime: runtime(),
    platform: process.platform,
    arch: process.arch,
    profile,
    doctor,
    run: chosen ? { metadata: chosen.metadata, events: readEvents(chosen.dir) } : null,
    sends: sends.slice(-RECENT_SENDS),
  }
  return JSON.parse(JSON.stringify(report).replaceAll(home, "~")) as Report
}

/** A letter the person's own mail program opens: address, subject and a short body. The file is attached by hand. */
export const mailtoFor = (report: Report, file: string): string => {
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
    `Файл отчёта приложен: ${file}`,
  ].join("\n")
  return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
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
