import type { MaxClient } from "../client.js"
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
  await client.connect({ token })
  store.writeToken(token)
}
