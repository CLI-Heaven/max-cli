import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs"
import { dirname } from "node:path"
import type { SessionStore } from "../session/store.js"
import { startingPath } from "./server.js"

/** A server a command started stops after this long unused. */
export const IDLE_MS = 15 * 60_000

/** After a background login MAX refused, commands leave the server alone this long. */
const REFUSED_PAUSE_MS = 10 * 60_000

/**
 * Written by a background server whose login MAX refused. Without it, every command after a
 * session expires would start a server that fails the same way — one more refused login each.
 * `max session start` removes it.
 */
export const refusedPath = (store: SessionStore): string => `${store.socketPath()}.refused`

/** A start that has not listened by now crashed; the next command may try again. */
const START_GRACE_MS = 30_000

/**
 * Starts `max serve` for this profile in the background, detached, and returns at once — the
 * command that asked goes on with its own connection and the next one finds the server.
 *
 * Its stderr goes to `<state>/profiles/<profile>.serve.log`, mode 600: nobody is watching a
 * terminal for it, and that file is where a login that failed says so.
 */
/** Where a background server writes what it would have said on a terminal. */
export const logPath = (store: SessionStore): string => `${store.socketPath().replace(/\.sock$/, "")}.serve.log`

export const startInBackground = (
  store: SessionStore,
  { serveArgs = ["--idle", `${IDLE_MS / 60_000}m`, "--started-by-command"], entry = process.argv[1] } = {},
): number | undefined => {
  if (!entry || store.readToken() === undefined) return undefined
  const refusedAt = statSync(refusedPath(store), { throwIfNoEntry: false })?.mtimeMs
  if (refusedAt !== undefined && Date.now() - refusedAt < REFUSED_PAUSE_MS) return undefined

  const lock = startingPath(store)
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 })
  try {
    closeSync(openSync(lock, "wx", 0o600))
  } catch {
    const since = statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0
    if (Date.now() - since <= START_GRACE_MS) return undefined
    rmSync(lock, { force: true })
    closeSync(openSync(lock, "wx", 0o600))
  }

  const log = openSync(logPath(store), "a", 0o600)
  const child = spawn(process.execPath, [entry, "--no-record", "serve", ...serveArgs], {
    detached: true,
    stdio: ["ignore", "ignore", log],
    env: { ...process.env, MAX_PROFILE: store.profile },
  })
  child.unref()
  closeSync(log)
  return child.pid
}
