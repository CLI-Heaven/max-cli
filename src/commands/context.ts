import type { Renderer, RenderFormat, Streams } from "@leemour/cli-core"
import type { Command } from "commander"
import { MaxClient, type MaxClientOptions } from "../client.js"
import { type GlobalFlags, resolveSettings, type Settings } from "../config.js"
import { withDeadline } from "../deadline.js"
import { resolveOutput } from "../output.js"
import { rootOf } from "../profile.js"
import { recorded } from "../runs/recording.js"
import { sendGuard } from "../sends/guard.js"
import { SendJournal, sendsPathFor } from "../sends/journal.js"
import { RecipientList, recipientsPathFor } from "../sends/recipients.js"
import { SessionStore } from "../session/store.js"

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
}

const environments = new WeakMap<Command, Environment>()

export const provide = (program: Command, environment: Environment): void => {
  environments.set(program, environment)
}

const environmentOf = (command: Command): Environment => environments.get(rootOf(command)) ?? {}

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
  /** Not connected yet: the action owns the `finally` that closes it — and the cache, if it opened one. */
  createClient: (extra?: Partial<Omit<MaxClientOptions, "store">>) => MaxClient
  /**
   * Runs the body with diagnostics on and the run finalized on every path, if anything asked for
   * either. The body gets the emitter to hand to `createClient`.
   */
  run: <T>(command: string, body: (events: MaxClientOptions["events"]) => Promise<T>) => Promise<T>
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
export const forCommand = (command: Command): CommandContext => {
  const environment = environmentOf(command)
  const settings = resolveSettings(command.optsWithGlobals<GlobalFlags>())
  const { renderer, format, color, streams } = resolveOutput({
    ...settings,
    ...(environment.streams ? { streams: environment.streams } : {}),
    ...(environment.tty === undefined ? {} : { tty: environment.tty }),
  })
  const store = environment.store?.(settings.profile) ?? new SessionStore({ profile: settings.profile })

  // Every client this command builds, so the deadline can shut them. There is always one; relying
  // on that is what makes the second one, some day, the leak that keeps the process alive.
  const clients: MaxClient[] = []

  return {
    settings,
    renderer,
    format,
    color,
    streams,
    store,
    createClient: (extra = {}) => {
      const client = new MaxClient({
        store,
        timeoutMs: settings.timeoutMs,
        warn: renderer.note,
        offline: command.optsWithGlobals().offline === true,
        sends: sendGuard({
          profile: settings.profile,
          readOnly: settings.readOnly,
          readOnlyFrom: settings.sources.readOnly,
          sendsPerHour: settings.sendsPerHour,
          journal: new SendJournal(sendsPathFor(settings.profile)),
          recipients: new RecipientList(recipientsPathFor(settings.profile)),
          warn: renderer.warn,
        }),
        ...(environment.connection ? { connection: environment.connection() } : {}),
        ...extra,
      })
      clients.push(client)
      return client
    },
    run: (command, body) =>
      withDeadline(settings.commandTimeoutMs, clients, () =>
        recorded(
          {
            command,
            profile: settings.profile,
            options: { record: settings.record, trace: settings.trace },
            format,
            streams,
            keepDays: settings.keepRunsForDays,
          },
          body,
        ),
      ),
  }
}
