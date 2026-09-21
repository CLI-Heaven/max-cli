import type { Renderer, RenderFormat } from "@leemour/cli-core"
import { MaxClient, type MaxClientOptions } from "../client.js"
import { type GlobalFlags, resolveSettings, type Settings } from "../config.js"
import { resolveOutput } from "../output.js"
import { recorded } from "../runs/recording.js"
import { SessionStore } from "../session/store.js"

export interface CommandContext {
  settings: Settings
  renderer: Renderer
  format: RenderFormat
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
export const forCommand = (flags: GlobalFlags): CommandContext => {
  const settings = resolveSettings(flags)
  const { renderer, format } = resolveOutput(settings)
  const store = new SessionStore({ profile: settings.profile })

  return {
    settings,
    renderer,
    format,
    store,
    createClient: (extra = {}) =>
      new MaxClient({ store, timeoutMs: settings.timeoutMs, warn: renderer.note, ...extra }),
    run: (command, body) =>
      recorded(
        {
          command,
          profile: settings.profile,
          options: { record: settings.record, verbose: settings.verbose },
          format,
          keepDays: settings.keepRunsForDays,
        },
        body,
      ),
  }
}
