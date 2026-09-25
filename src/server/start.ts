import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs"
import { dirname } from "node:path"
import type { SessionStore } from "../session/store.js"
import { VERSION } from "../version.js"
import { answers, startingPath } from "./server.js"
import { serverStatus, stopServer } from "./server-connection.js"

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
    env: serverEnvironment(process.env, store.profile),
  })
  child.unref()
  closeSync(log)
  return child.pid
}

/** Logging in takes a second or two; a server that has not answered by now is not coming. */
const START_WAIT_MS = 15_000

/**
 * A server for this profile, answering — started if none is, waited for if another command is
 * already starting one. `false`: none came up (no session, or MAX refused its login lately).
 */
export const ensureServer = async (store: SessionStore): Promise<boolean> => {
  if (await answers(store.socketPath())) {
    if (!(await replacedIfStale(store))) return true
  }
  if (store.readToken() === undefined) return false
  const refusedAt = statSync(refusedPath(store), { throwIfNoEntry: false })?.mtimeMs
  if (refusedAt !== undefined && Date.now() - refusedAt < REFUSED_PAUSE_MS) return false

  const asked = Date.now()
  startInBackground(store)
  const until = asked + START_WAIT_MS
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    if (await answers(store.socketPath())) return true
    if ((statSync(refusedPath(store), { throwIfNoEntry: false })?.mtimeMs ?? 0) >= asked) return false
  }
  return false
}

/**
 * A server a command started under another version gives way: it speaks to MAX with that
 * version's code, and after an upgrade that can be a different protocol altogether. One started by
 * hand is the owner's to stop.
 */
export const replacedIfStale = async (store: SessionStore): Promise<boolean> => {
  const status = await serverStatus(store.socketPath())
  if (!status || status.version === VERSION || status.byHand === true) return false
  return (await stopServer(store.socketPath())) === "stopped"
}

/** The server outlives the command by minutes; a token it was not given for keeping stays behind. */
export const serverEnvironment = ({ MAX_TOKEN: _, ...env }: NodeJS.ProcessEnv, profile: string): NodeJS.ProcessEnv => ({
  ...env,
  MAX_PROFILE: profile,
})
