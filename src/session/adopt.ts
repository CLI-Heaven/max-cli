import { rmSync } from "node:fs"
import type { MaxClient } from "../client.js"
import { refusedPath } from "../server/start.js"
import type { SessionStore } from "./store.js"

/**
 * Takes a token into a profile — **logging in first, and writing to the keyring only after.**
 *
 * The order is the whole point, and it is the opposite of what the command did until 2026-09-21.
 * Writing first looks harmless because the login is about to happen anyway; what it actually means
 * is that a typo, an expired token or a browser tab that has been closed replaces a *working*
 * credential with a dead one. There is no way back: `Credentials.write` overwrites unconditionally
 * and a keyring entry cannot be read out again afterwards. The same shape destroyed two working
 * keys in `brazecli` on 2026-09-14 — `cli-core`'s own `credentials.ts` says so.
 *
 * Restoring the old token after a failed login was the obvious alternative and is worse: a process
 * killed between the write and the restore leaves the profile broken. Here nothing is written until
 * there is something worth writing, so there is no window to die in.
 *
 * It lives beside `handshake.ts` rather than in the command for the same reason that one does:
 * `forCommand` builds its own store and its own socket, so anything left inside a command action
 * cannot be driven by a test — and this ordering is too expensive to hold on trust.
 */
export const adoptToken = async (client: MaxClient, store: SessionStore, token: string): Promise<void> => {
  const before = store.readToken()
  await client.connect({ token })

  // ⚠ **Only if the login did not already leave a better one.** MAX answers a login with a fresh
  // token when the one presented has aged, and `connect` keeps it (`MAX-11`); overwriting that here
  // would put back the older credential. Comparing with what was stored before, rather than asking
  // whether anything is stored, is what lets a new login replace an old session at all — until
  // 2026-09-24 a profile that already held a token kept it, and the command still said "stored".
  if (store.readToken() === before) store.writeToken(token)
  // A new session: background servers may try again at once.
  rmSync(refusedPath(store), { force: true })
}
