import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs"
import { dirname } from "node:path"
import type { SessionStore } from "../session/store.js"
import { startingPath } from "./server.js"

/** A server a command started stops after this long unused. */
export const IDLE_MS = 15 * 60_000

/** A start that has not listened by now crashed; the next command may try again. */
const START_GRACE_MS = 30_000

/**
 * Starts `max serve` for this profile in the background, detached, and returns at once — the
 * command that asked goes on with its own connection and the next one finds the server.
 *
 * Its stderr goes to `<state>/profiles/<profile>.serve.log`, mode 600: nobody is watching a
 * terminal for it, and that file is where a login that failed says so.
 */
export const startInBackground = (store: SessionStore, entry = process.argv[1]): boolean => {
  if (!entry || store.readToken() === undefined) return false

  const lock = startingPath(store)
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 })
  try {
    closeSync(openSync(lock, "wx", 0o600))
  } catch {
    const since = statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0
    if (Date.now() - since <= START_GRACE_MS) return false
    rmSync(lock, { force: true })
    closeSync(openSync(lock, "wx", 0o600))
  }

  const log = openSync(`${store.socketPath().replace(/\.sock$/, "")}.serve.log`, "a", 0o600)
  const child = spawn(
    process.execPath,
    [entry, "--no-record", "serve", "--idle", `${IDLE_MS / 60_000}m`, "--started-by-command"],
    {
      detached: true,
      stdio: ["ignore", "ignore", log],
      env: { ...process.env, MAX_PROFILE: store.profile },
    },
  )
  child.unref()
  closeSync(log)
  return true
}
