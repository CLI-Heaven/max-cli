import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Credentials, type KeyringStore, pathsAreOverridden, resolvePaths, writeSecurely } from "@leemour/cli-core"

/**
 * What a MAX session actually is: a token, and an identity for this installation.
 *
 * **The token lives in the OS keyring; the rest lives in a file.** The split is not decoration —
 * the token is the credential, and the device identity is merely identifying, but it must be
 * *stable*: a client that presents a new device on every command is not imitating a real client
 * (REQUIREMENTS §34), and MAX ties sessions to it.
 */
export interface SessionState {
  deviceId: string
  /** Set once the account is known; only used to tell our own messages from other people's. */
  viewerId?: string
  /** Counts logins so a token that stops working can be explained rather than guessed at (NEED-8). */
  logins: number
  lastLoginAt?: string
  /** Where `max inbox` starts next time: the newest message it has read (`NEED-162`). */
  lastCheckAt?: string
  /** Logins MAX refused for too many attempts in a row; a login that succeeds clears it (`MAX-38`). */
  loginRefusals?: number
  /** No login before this time, ISO 8601. */
  loginPausedUntil?: string
}

/**
 * **How long a profile stays out after each refusal in a row** (owner, `NEED-265`). In PyMax a
 * login retried after the limit error kept the account locked (PyMax #106), so the wait grows.
 */
export const LOGIN_PAUSES_MS = [1, 5, 30, 60, 6 * 60, 24 * 60].map((minutes) => minutes * 60_000)

/** When the pause ends, or `undefined` if a login may go out now. */
export const loginPausedUntil = (state: SessionState, now = Date.now()): string | undefined =>
  state.loginPausedUntil !== undefined && Date.parse(state.loginPausedUntil) > now ? state.loginPausedUntil : undefined

export const withLoginRefused = (state: SessionState, now = Date.now()): SessionState => {
  const refusals = (state.loginRefusals ?? 0) + 1
  const wait = LOGIN_PAUSES_MS[Math.min(refusals, LOGIN_PAUSES_MS.length) - 1] ?? 0
  return { ...state, loginRefusals: refusals, loginPausedUntil: new Date(now + wait).toISOString() }
}

export const withoutLoginPause = ({ loginRefusals, loginPausedUntil, ...state }: SessionState): SessionState => state

export interface SessionStoreOptions {
  profile?: string
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  /** Overrides the config and state directories; tests pass a temporary one. */
  configDir?: string
  stateDir?: string
}

const APP = "max-cli"

export class SessionStore {
  readonly profile: string
  readonly #stateDir: string
  readonly #credentials: Credentials

  constructor({ profile = "default", env = process.env, keyring, configDir, stateDir }: SessionStoreOptions = {}) {
    const paths = resolvePaths({ appName: APP, prefix: "MAX", env })
    this.profile = profile
    this.#stateDir = stateDir ?? paths.state
    this.#credentials = new Credentials({
      configDir: configDir ?? paths.config,
      service: APP,
      envVar: "MAX_TOKEN",
      isolated: pathsAreOverridden({ appName: APP, prefix: "MAX", env }),
      ...(keyring ? { keyring } : {}),
      env,
      warn: (message) => process.stderr.write(`${message}\n`),
    })
  }

  /** `undefined` means nobody has logged in on this profile. */
  readToken(): string | undefined {
    return this.#credentials.read(this.profile)?.secret
  }

  writeToken(token: string): void {
    this.#credentials.write(this.profile, token)
  }

  /**
   * Reads the state, inventing a device identity the first time and keeping it thereafter.
   *
   * **A new identity is written out immediately, before it is used for anything.** Returning one
   * without saving it looks harmless and is not: a login that fails, or simply a second call,
   * would then present MAX with a different device every time — which is the "new device on every
   * command" that §34 exists to prevent. Found by a test, not by a user.
   */
  readState(): SessionState {
    try {
      const parsed = JSON.parse(readFileSync(this.#statePath(), "utf8")) as Partial<SessionState>
      if (typeof parsed.deviceId === "string" && parsed.deviceId !== "") {
        return { deviceId: parsed.deviceId, logins: parsed.logins ?? 0, ...pick(parsed) }
      }
    } catch {
      // No state yet, or a file we cannot read: either way the answer is a fresh identity.
    }

    const fresh: SessionState = { deviceId: randomUUID(), logins: 0 }
    this.writeState(fresh)
    return fresh
  }

  /** Whether this profile has logged in on this machine. Reads only: unlike `readState`, never creates the file. */
  hasLoggedIn(): boolean {
    try {
      const parsed = JSON.parse(readFileSync(this.#statePath(), "utf8")) as Partial<SessionState>
      return (parsed.logins ?? 0) > 0 || typeof parsed.viewerId === "string"
    } catch {
      return false
    }
  }

  writeState(state: SessionState): void {
    writeSecurely(this.#statePath(), `${JSON.stringify(state, null, 2)}\n`, 0o600)
  }

  /** Forgets everything about this profile. Returns whether there was a token to forget. */
  forget(): boolean {
    const had = this.readToken() !== undefined
    this.#credentials.remove(this.profile)
    try {
      writeSecurely(this.#statePath(), `${JSON.stringify({ deviceId: randomUUID(), logins: 0 }, null, 2)}\n`, 0o600)
    } catch {
      // Nothing to reset.
    }
    return had
  }

  /** Where `max serve` listens for this profile. Beside the state file, so a sandbox moves both. */
  socketPath(): string {
    return join(this.#stateDir, "profiles", `${this.profile}.sock`)
  }

  #statePath(): string {
    return join(this.#stateDir, "profiles", `${this.profile}.json`)
  }
}

const pick = (state: Partial<SessionState>) => {
  const extra: Partial<SessionState> = {}
  if (typeof state.viewerId === "string") extra.viewerId = state.viewerId
  if (typeof state.lastLoginAt === "string") extra.lastLoginAt = state.lastLoginAt
  if (typeof state.lastCheckAt === "string") extra.lastCheckAt = state.lastCheckAt
  if (typeof state.loginRefusals === "number") extra.loginRefusals = state.loginRefusals
  if (typeof state.loginPausedUntil === "string") extra.loginPausedUntil = state.loginPausedUntil
  return extra
}
