import { existsSync } from "node:fs"
import { CliError, configFilePath, loadConfigFile, resolvePaths, saveConfigFile } from "@leemour/cli-core"
import * as v from "valibot"
import { DEFAULT_PROFILE, usableProfileName } from "./profile.js"

const APP = "max-cli"
const DEFAULT_LIMIT = 20
const DEFAULT_KEEP_RUNS_FOR_DAYS = 30

const plain =
  (rule: string) =>
  (issue: v.BaseIssue<unknown>): string =>
    `${rule}, not ${issue.received}`
const wholeNumber = plain("has to be a whole number, 1 or more")
const count = v.pipe(v.number(wholeNumber), v.integer(wholeNumber), v.minValue(1, wholeNumber))
const flag = v.boolean(plain("has to be true or false"))

/** valibot's own words ("Expected never but received …") mean nothing to someone editing a file. */
const objectMessage =
  (known: string[]): v.ErrorMessage<v.StrictObjectIssue> =>
  (issue) =>
    issue.expected === "never"
      ? `unknown setting — the known ones are ${known.join(", ")}`
      : "has to be an object, in braces"

/**
 * ⚠ `strictObject`, not `object`: an unknown key is an error here.
 *
 * `object()` drops what it does not recognise — measured with valibot 1.5, `{ limitt: 5 }` parses
 * to `{}` and reports nothing — so a misspelled setting would run with the default and never say
 * why. That is the failure this schema exists to prevent, and it is the **opposite** of the rule
 * for MAX's own answers, which keep unknown fields on purpose (`NEED-35`).
 *
 * **No field here can hold a secret.** No token, no phone number, no chat id: a schema with
 * nowhere to put one is stronger than a rule saying do not put one there.
 */
const profileEntries = {
  limit: v.optional(count),
  timeoutMs: v.optional(count),
  color: v.optional(flag),
  senderColors: v.optional(flag),
  /** The run log reads these two; nothing records anything until it exists. */
  record: v.optional(flag),
  keepRunsForDays: v.optional(count),
}
const profileSettings = v.strictObject(profileEntries, objectMessage(Object.keys(profileEntries)))

const configEntries = {
  defaultProfile: v.optional(v.string(plain("has to be a profile name, in quotes"))),
  /** What every profile gets unless it says otherwise. */
  defaults: v.optional(profileSettings),
  profiles: v.optional(v.record(v.string(), profileSettings, "has to be an object of profiles, by name"), {}),
}
export const configSchema = v.strictObject(configEntries, objectMessage(Object.keys(configEntries)))

export type Config = v.InferOutput<typeof configSchema>

export type ProfileSetting = keyof v.InferOutput<typeof profileSettings>
export const PROFILE_SETTINGS = Object.keys(profileSettings.entries) as ProfileSetting[]

/** Whatever the command line carried. Everything is optional: absent means "not given here". */
export interface GlobalFlags {
  profile?: string
  json?: boolean
  jsonl?: boolean
  quiet?: boolean
  verbose?: number
  trace?: boolean
  limit?: number
  page?: number
  all?: boolean
  record?: boolean
  /** Raw text from `--timeout`, parsed here so the unit rule lives in one place. */
  timeout?: string
}

export interface Settings {
  profile: string
  /** Where the profile came from, decided here so nothing has to re-derive the order. */
  json: boolean
  jsonl: boolean
  quiet: boolean
  /** How much of what the model knows a human view shows: `-v`, `-vv`. */
  detail: 0 | 1 | 2
  trace: boolean
  /** Unset means "decide from the terminal", which is `resolveOutput`'s job, not this one's. */
  color: boolean | undefined
  /** A colour per sender in `messages` — a matter of taste, so off until the profile asks. */
  senderColors: boolean
  limit: number
  /** Which page, 1-based. Per invocation only — a page number in a configuration file is a setting nobody wants twice. */
  page: number
  /** Every row, no paging. Also per invocation only. */
  all: boolean
  /** Unset means the transport's own default; the number lives in `protocol/connection.ts`. */
  timeoutMs: number | undefined
  /**
   * How long the **whole command** may take, or `undefined` for no bound.
   *
   * ⚠ Not the same thing as `timeoutMs`, which is one request's wait. One read is a connect, an
   * INIT, a LOGIN, a name to resolve and then the request itself, so the wall clock is a multiple
   * of `timeoutMs` and never equal to it. An agent given thirty seconds needs to say *thirty
   * seconds*, and this is the only setting that means that.
   *
   * They are spelled differently on purpose — a number of milliseconds in the file, a duration
   * with a unit on the command line — because two settings called "timeout" that mean different
   * things are otherwise a trap.
   */
  commandTimeoutMs: number | undefined
  record: boolean
  keepRunsForDays: number
  /** Named in errors and in `max --help`, so a person can find the file that decided this. */
  configPath: string
  configFound: boolean
  /** Profiles the configuration file names, whether or not anyone has logged in to them. */
  configuredProfiles: string[]
  /** Where each value came from — `max config show` prints it. */
  sources: Record<SourcedSetting, Source>
}

export type Source =
  | "first word"
  | "flag"
  | "MAX_PROFILE"
  | "MAX_TIMEOUT"
  | "config file"
  | "config defaults"
  | "default"
export type SourcedSetting =
  | "profile"
  | "limit"
  | "timeoutMs"
  | "commandTimeoutMs"
  | "color"
  | "senderColors"
  | "record"
  | "keepRunsForDays"

/** The first given value wins, and says which it was. */
const first = <T>(candidates: [Source, T | undefined][], fallback: T): { value: T; from: Source } => {
  for (const [from, value] of candidates) if (value !== undefined) return { value, from }
  return { value: fallback, from: "default" }
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv
  /** Tests pass a temporary directory; nothing else should need this. */
  configDir?: string
}

/**
 * **Flag, then environment, then the configuration file, then the built-in default.** One place,
 * so no command can decide the order differently from another.
 *
 * ⚠ **Only two settings actually have the middle step** — `MAX_PROFILE` and `MAX_TIMEOUT` — and
 * that is deliberate rather than unfinished (`NEED-119`). They are the two an agent sets once for
 * a whole process. A variable for `--json` or `--color` would be worse than missing: one left set
 * in a shell silently changes the output of a command that never asked for it.
 *
 * Two things already jump this queue and are documented rather than re-litigated here:
 * `MAX_TOKEN` outranks the keyring (`cli-core`'s `Credentials.read`), and `MAX_CONFIG_DIR`,
 * `MAX_STATE_DIR` or `MAX_CACHE_DIR` move the whole installation — including which keyring entry
 * a profile means (`ARCHITECTURE.md` §14).
 */
export const resolveSettings = (flags: GlobalFlags = {}, { env = process.env, configDir }: ResolveOptions = {}) => {
  const paths = resolvePaths({ appName: APP, prefix: "MAX", env })
  const configPath = configFilePath(configDir ?? paths.config)
  const config = readConfig(configPath)

  const profile = first(
    [
      ["first word", flags.profile],
      ["MAX_PROFILE", given(env.MAX_PROFILE)],
      ["config file", config.defaultProfile],
    ],
    DEFAULT_PROFILE,
  )
  const configured = config.profiles[usableProfileName(profile.value)] ?? {}
  const shared = config.defaults ?? {}

  const limit = first<number>(
    [
      ["flag", flags.limit],
      ["config file", configured.limit],
      ["config defaults", shared.limit],
    ],
    DEFAULT_LIMIT,
  )
  const timeoutMs = first<number | undefined>(
    [
      ["config file", configured.timeoutMs],
      ["config defaults", shared.timeoutMs],
    ],
    undefined,
  )
  const color = first<boolean | undefined>(
    [
      ["config file", configured.color],
      ["config defaults", shared.color],
    ],
    undefined,
  )
  const senderColors = first(
    [
      ["config file", configured.senderColors],
      ["config defaults", shared.senderColors],
    ],
    false,
  )
  const record = first(
    [
      ["flag", flags.record],
      ["config file", configured.record],
      ["config defaults", shared.record],
    ],
    false,
  )
  const keepRunsForDays = first(
    [
      ["config file", configured.keepRunsForDays],
      ["config defaults", shared.keepRunsForDays],
    ],
    DEFAULT_KEEP_RUNS_FOR_DAYS,
  )

  /**
   * ⚠ **The only setting with no `config file` row, on purpose.** A budget for one command is
   * about a particular run, not a habit, and a timeout written into a file is one somebody trips
   * over months later without remembering they set it.
   */
  const timeout = first<string | undefined>(
    [
      ["flag", flags.timeout],
      ["MAX_TIMEOUT", given(env.MAX_TIMEOUT)],
    ],
    undefined,
  )

  const settings: Settings = {
    profile: usableProfileName(profile.value),
    json: flags.json === true,
    jsonl: flags.jsonl === true,
    quiet: flags.quiet === true,
    detail: Math.min(2, Math.max(0, flags.verbose ?? 0)) as 0 | 1 | 2,
    trace: flags.trace === true,
    color: color.value,
    senderColors: senderColors.value,
    limit: limit.value,
    page: flags.page ?? 1,
    all: flags.all === true,
    timeoutMs: timeoutMs.value,
    commandTimeoutMs: durationMs(timeout.value, timeout.from),
    record: record.value,
    keepRunsForDays: keepRunsForDays.value,
    configPath,
    configFound: existsSync(configPath),
    configuredProfiles: Object.keys(config.profiles),
    sources: {
      profile: profile.from,
      limit: limit.from,
      timeoutMs: timeoutMs.from,
      commandTimeoutMs: timeout.from,
      color: color.from,
      senderColors: senderColors.from,
      record: record.from,
      keepRunsForDays: keepRunsForDays.from,
    },
  }

  // The file was checked by the schema; a flag was not, and `--limit abc` is `NaN` by the time it
  // gets here, which slices an array to nothing without complaining.
  if (!Number.isInteger(settings.limit) || settings.limit < 1) {
    throw new CliError("validation_error", `--limit takes a whole number from 1 upwards, not ${flags.limit}`)
  }

  if (!Number.isInteger(settings.page) || settings.page < 1) {
    throw new CliError("validation_error", `--page takes a whole number from 1 upwards, not ${flags.page}`)
  }

  // Refused rather than resolved: one of the two would silently win, and which one is exactly the
  // sort of thing a caller discovers from a wrong answer rather than from a message.
  if (settings.all && flags.page !== undefined) {
    throw new CliError("validation_error", "--all and --page ask for different things; use one or the other")
  }

  return settings
}

/**
 * The profile names written in the configuration file.
 *
 * ⚠ **This is not every profile that works.** `max <name> session start` stores a token under any
 * name without writing anything to the file, so a profile can be in daily use and absent here.
 * Whoever prints this has to say so, or it reads as a complete list and quietly is not.
 */
export const configuredProfiles = ({ env = process.env, configDir }: ResolveOptions = {}): string[] => {
  const paths = resolvePaths({ appName: APP, prefix: "MAX", env })
  return Object.keys(readConfig(configFilePath(configDir ?? paths.config)).profiles).sort()
}

/**
 * `30s`, `2m`, `500ms` — **the unit is required, and a bare number is refused.**
 *
 * `--timeout 30` is ambiguous in a way that costs real time: the neighbouring setting in the
 * configuration file is called `timeoutMs` and is milliseconds, while every other tool that spells
 * it this way means seconds. Guessing either one is a thirty-fold surprise in one direction or the
 * other, so this asks instead — the same rule as `--kind`, and the reason is the same.
 *
 * The refusal names whichever of the two supplied the value — see `durationMs`.
 */
const DURATION = /^(\d+)(ms|s|m)$/

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000 }

const durationMs = (value: string | undefined, from: Source): number | undefined => {
  if (value === undefined) return undefined

  // Named by where it came from, so somebody who set `MAX_TIMEOUT` in a shell profile weeks ago is
  // told which thing is wrong rather than shown a flag they never typed.
  const source = from === "MAX_TIMEOUT" ? "MAX_TIMEOUT" : "--timeout"
  const match = DURATION.exec(value.trim())
  if (!match?.[1] || !match[2]) {
    throw new CliError("validation_error", `${source} takes a duration with a unit — 30s, 2m or 500ms — not "${value}"`)
  }

  const ms = Number(match[1]) * (UNIT_MS[match[2]] ?? 0)
  if (ms <= 0) {
    throw new CliError("validation_error", `${source} has to be more than zero, and "${value}" is not`)
  }
  return ms
}

/**
 * Sets or removes one setting of one profile, or of `defaults`, and writes the file back.
 *
 * **The value is checked by the same schema that reads the file**, on the whole result, before
 * anything is written — so `config set` cannot produce a file the next command refuses to load.
 */
export const changeSetting = (
  path: string,
  { profile, setting, value }: { profile: string | undefined; setting: string; value: string | undefined },
): unknown => {
  if (!(PROFILE_SETTINGS as string[]).includes(setting)) {
    throw new CliError("validation_error", `no setting called "${setting}" — one of: ${PROFILE_SETTINGS.join(", ")}`)
  }

  const config = readConfig(path)
  const scope = { ...(profile === undefined ? config.defaults : config.profiles[profile]) } as Record<string, unknown>
  if (value === undefined) delete scope[setting]
  else scope[setting] = parseValue(value)

  const changed =
    profile === undefined
      ? { ...config, defaults: scope }
      : { ...config, profiles: { ...config.profiles, [profile]: scope } }
  if (profile === undefined && Object.keys(scope).length === 0) delete changed.defaults
  if (profile !== undefined && Object.keys(scope).length === 0) delete changed.profiles[profile]

  const checked = v.safeParse(configSchema, changed)
  if (!checked.success) {
    throw new CliError(
      "validation_error",
      `${setting} cannot be "${value}": ${checked.issues[0]?.message ?? "invalid"}`,
    )
  }
  saveConfigFile(path, checked.output)
  return scope[setting] ?? null
}

/** `50` is a number and `true` a boolean, as they would be in the file; anything else stays text. */
const parseValue = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * A missing file is not an error — it is a program nobody has configured. A malformed one is, in
 * every output mode: an agent reading JSON deserves the same refusal a person gets, and silently
 * falling back to the defaults is what makes a typo cost an afternoon.
 */
const readConfig = (path: string): Config => {
  try {
    return loadConfigFile(path, configSchema, () => ({ profiles: {} }))
  } catch (error) {
    throw new CliError("configuration_error", error instanceof Error ? error.message : String(error))
  }
}

/** An environment variable set to the empty string is not a value; it is the shell being unset. */
const given = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}
