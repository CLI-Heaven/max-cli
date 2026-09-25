import { existsSync } from "node:fs"
import type { Renderer, RenderFormat, Streams } from "@leemour/cli-core"
import type { Command } from "commander"
import { MaxClient, type MaxClientOptions } from "../client.js"
import { type GlobalFlags, resolveSettings, type Settings } from "../config.js"
import { type Closeable, withDeadline } from "../deadline.js"
import { resolveOutput } from "../output.js"
import { rootOf } from "../profile.js"
import { recorded } from "../runs/recording.js"
import { sendGuard } from "../sends/guard.js"
import { SendJournal, sendsPathFor } from "../sends/journal.js"
import { RecipientList, recipientsPathFor } from "../sends/recipients.js"
import { ServerConnection, stopServer } from "../server/server-connection.js"
import { ensureServer } from "../server/start.js"
import { type BrowserDoors, realBrowser } from "../session/browser.js"
import { readSecret } from "../session/prompt.js"
import { SessionStore } from "../session/store.js"
import type { UpdateEnvironment } from "../update.js"

/**
 * What a command writes to and talks through, when it is not the real terminal, keyring and MAX.
 * `run` sets it on the program; without it everything is the real thing.
 */
export interface Environment {
  streams?: Streams
  tty?: boolean
  /** A store over a memory keyring, so a test never touches the owner's. */
  store?: (profile: string) => SessionStore
  /** A fresh connection per client — to a scripted MAX in a test. */
  connection?: () => NonNullable<MaxClientOptions["connection"]>
  browser?: BrowserDoors
  ask?: Ask
  interactive?: boolean
  columns?: number
  update?: UpdateEnvironment
}

/** One line from the person at the terminal; `secret` keeps it off the screen. */
export type Ask = (prompt: string, options?: { secret?: boolean }) => Promise<string>

const environments = new WeakMap<Command, Environment>()

export const provide = (program: Command, environment: Environment): void => {
  environments.set(program, environment)
}

export const environmentOf = (command: Command): Environment => environments.get(rootOf(command)) ?? {}

/** For the commands that print but never need settings or a client. */
export const outputFor = (command: Command) => {
  const { streams, tty } = environmentOf(command)
  return resolveOutput({
    ...command.optsWithGlobals(),
    ...(streams ? { streams } : {}),
    ...(tty === undefined ? {} : { tty }),
  })
}

export interface CommandContext {
  settings: Settings
  renderer: Renderer
  format: RenderFormat
  /** Whether the human view may use colour — the renderer's decision, handed to views that print their own text. */
  color: boolean
  streams: Streams
  store: SessionStore
  /**
   * Not connected yet: the action owns the `finally` that closes it — and the cache, if it opened one.
   * It goes through the profile's one `max serve`; `own` is for logging in, which cannot.
   */
  createClient: (extra?: Partial<Omit<MaxClientOptions, "store">>, options?: { own?: boolean }) => MaxClient
  /**
   * Starts the profile's server if none is running and waits for it; `false` when it did not come
   * up, or when this is not the place to start one (`serve: false`, a test).
   */
  shareServer: () => Promise<boolean>
  /** Stops the profile's server however it was started — `max session start` replaces its session. */
  stopServer: () => Promise<"stopped" | "refused" | "none">
  /**
   * Runs the body with diagnostics on and the run finalized on every path, if anything asked for
   * either. The body gets the emitter to hand to `createClient`.
   */
  run: <T>(command: string, body: (events: MaxClientOptions["events"]) => Promise<T>) => Promise<T>
  /** Anything else holding the process open — a browser, a local page — for `--timeout` to shut too. */
  track: (closeable: Closeable) => void
  browser: BrowserDoors
  ask: Ask
  /** Whether a person is there to scan a code or type one: both stdin and stderr are a terminal. */
  interactive: boolean
  /** How wide the terminal is that diagnostics go to; unknown when it is not a terminal. */
  columns: number | undefined
}

/**
 * Everything a command needs, resolved once — and **the only place a `MaxClient` is built.**
 *
 * One construction site is what keeps the protocol note quiet under `--quiet`: a command building
 * its own client gets the default `warn`, which writes straight to stderr past the renderer
 * (`BUG-7`). With eight commands, "remember to pass `warn`" is a rule that gets broken once and
 * then nobody can see it.
 *
 * It is also where `--record` stops being a flag and becomes a setting: `recorded` takes what
 * `resolveSettings` decided — flag, then environment, then the configuration file — rather than
 * what `commander` happened to parse.
 *
 * The cache is not opened here on purpose — only the reading commands want one, and opening it
 * would create a database file for `session end`, which will never read it.
 */
export const forCommand = (command: Command): CommandContext =>
  contextFor(command.optsWithGlobals<GlobalFlags & { offline?: boolean }>(), environmentOf(command))

/** The same context from flags already parsed — for `max mcp`, whose calls arrive without argv. */
export const contextFor = (
  flags: GlobalFlags & { offline?: boolean },
  environment: Environment = {},
): CommandContext => {
  const settings = resolveSettings(flags)
  const { renderer, format, color, streams } = resolveOutput({
    ...settings,
    ...(environment.streams ? { streams: environment.streams } : {}),
    ...(environment.tty === undefined ? {} : { tty: environment.tty }),
  })
  const store = environment.store?.(settings.profile) ?? new SessionStore({ profile: settings.profile })

  // Every client this command builds, so the deadline can shut them. There is always one; relying
  // on that is what makes the second one, some day, the leak that keeps the process alive.
  const clients: Closeable[] = []

  // Only for the real thing: a test hands in its own store, and must never start a process.
  const starts = !environment.store && !environment.connection && settings.serve

  return {
    settings,
    renderer,
    format,
    color,
    streams,
    store,
    shareServer: async () => starts && ensureServer(store),
    stopServer: () => stopServer(store.socketPath(), { force: true }),
    createClient: (extra = {}, { own = false } = {}) => {
      const timeout = settings.timeoutMs ? { timeoutMs: settings.timeoutMs } : {}
      const shares = starts && flags.offline !== true
      const wire =
        !own && (shares || existsSync(store.socketPath()))
          ? new ServerConnection({
              path: store.socketPath(),
              store,
              ...timeout,
              ...(shares ? { ensure: () => ensureServer(store) } : {}),
            })
          : undefined
      const client = new MaxClient({
        store,
        timeoutMs: settings.timeoutMs,
        warn: renderer.note,
        offline: flags.offline === true,
        sends: sendGuard({
          profile: settings.profile,
          readOnly: settings.readOnly,
          readOnlyFrom: settings.sources.readOnly,
          ...(settings.allow ? { allow: settings.allow, allowFrom: settings.sources.allow } : {}),
          sendsPerHour: settings.sendsPerHour,
          journal: new SendJournal(sendsPathFor(settings.profile)),
          recipients: new RecipientList(recipientsPathFor(settings.profile)),
          warn: renderer.warn,
        }),
        ...(environment.connection ? { connection: environment.connection() } : wire ? { connection: wire } : {}),
        ...extra,
      })
      clients.push(client)
      return client
    },
    track: (closeable) => {
      clients.push(closeable)
    },
    browser: environment.browser ?? realBrowser,
    ask: environment.ask ?? ((prompt, { secret = false } = {}) => readSecret(prompt, { echo: !secret })),
    interactive: environment.interactive ?? (process.stdin.isTTY === true && process.stderr.isTTY === true),
    columns: environment.columns ?? process.stderr.columns,
    run: (command, body) =>
      withDeadline(settings.commandTimeoutMs, clients, () =>
        recorded(
          {
            command,
            profile: settings.profile,
            options: { record: settings.record, keepFailed: settings.keepFailedRuns, trace: settings.trace },
            format,
            streams,
            keepDays: settings.keepRunsForDays,
          },
          body,
        ),
      ),
  }
}
