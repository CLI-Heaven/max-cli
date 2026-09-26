import { closeSync, existsSync, openSync, readSync, realpathSync } from "node:fs"
import { posix, win32 } from "node:path"
import { fileURLToPath } from "node:url"
import { type Installer, installerOf } from "@leemour/cli-core/update"

export interface InstallOptions {
  scriptPath: string
  execPath: string
  /** `node 24.19.0` or `bun 1.3.14`: under Bun, `process.versions.node` is the version it imitates. */
  runtime: string
  env: NodeJS.ProcessEnv
  /** Injected, never read at import: Linux CI then covers the Windows branch on every push. */
  platform: NodeJS.Platform
  exists?: (file: string) => boolean
  realpath?: (file: string) => string
  read?: (file: string) => string
}

export interface Install {
  runtime: { version: string; path: string }
  installer: Installer
  /** Where the package manager put the `max` command; `null` when this install has none or it cannot be told. */
  binDir: string | null
  binDirOnPath: boolean | null
  /** The `max` a new terminal would run, or `null` for none on PATH. */
  onPath: string | null
  /** Whether that `max` is max-cli at all — any copy — rather than another program called `max`. */
  isMaxCli: boolean | null
  /** Commands that put `binDir` on PATH, for this platform's shell. Empty when nothing is wrong. */
  fix: string[]
}

const PACKAGE_DIR = ["node_modules", "@leemour", "max-cli"]
const SCRIPT_TAIL = "max-cli/dist/bin/max.js"

/** This installation's `dist/bin/max.js`, through any link — what `node <script>` must be given. */
export const ownScript = (): string => {
  const script = fileURLToPath(new URL("./bin/max.js", import.meta.url))
  try {
    return realpathSync(script)
  } catch {
    return script
  }
}

/**
 * **Where the command is and whether a terminal finds it**, worked out from our own path and the
 * environment only. No `npm prefix -g`: on Windows `npm` is `npm.cmd`, which Node does not start
 * without a shell, and `doctor` has to answer quickly when everything else is broken.
 */
export const checkInstall = ({
  scriptPath,
  execPath,
  runtime,
  env,
  platform,
  exists = existsSync,
  realpath = realpathSync,
  read = head,
}: InstallOptions): Install => {
  const windows = platform === "win32"
  const path = windows ? win32 : posix
  const installer = installerOf(scriptPath)
  const names = commandNames(env, windows)
  const hasCommand = (dir: string) => names.some((name) => exists(path.join(dir, name)))

  const guessed = binDirOf(installer, scriptPath, env, windows)
  const binDir = guessed !== null && hasCommand(guessed) ? guessed : null
  const directories = pathEntries(env, windows).map((entry) => same(entry, path, windows))
  const binDirOnPath = binDir === null ? null : directories.includes(same(binDir, path, windows))

  const onPath = firstOnPath(pathEntries(env, windows), names, path, exists)
  const maxCli = onPath === null ? null : isMaxCli(onPath, { realpath, read })

  return {
    runtime: { version: runtime, path: execPath },
    installer,
    binDir,
    binDirOnPath,
    onPath,
    isMaxCli: maxCli,
    // A PATH entry can be a link to the same folder; if a terminal already finds max-cli, nothing needs fixing.
    fix: binDir !== null && binDirOnPath === false && maxCli !== true ? pathFix(binDir, windows) : [],
  }
}

/** Every PATH key, whatever its case: an environment object built by hand keeps Windows' `Path`. */
const pathEntries = (env: NodeJS.ProcessEnv, windows: boolean): string[] => {
  const key = Object.keys(env).find((name) => (windows ? name.toUpperCase() === "PATH" : name === "PATH"))
  const value = key === undefined ? "" : (env[key] ?? "")
  return value
    .split(windows ? ";" : ":")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry !== "")
}

const same = (dir: string, path: typeof posix, windows: boolean): string => {
  const normal = path.normalize(dir).replace(/[\\/]+$/, "")
  return windows ? normal.toLowerCase() : normal
}

/** On Windows the shell tries each extension in `PATHEXT`; npm writes `max.cmd`, bun `max.exe`. */
const commandNames = (env: NodeJS.ProcessEnv, windows: boolean): string[] => {
  if (!windows) return ["max"]
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATHEXT")
  const extensions = (key === undefined ? undefined : env[key]) ?? ".COM;.EXE;.BAT;.CMD"
  return extensions
    .split(";")
    .filter((extension) => extension !== "")
    .map((extension) => `max${extension.toLowerCase()}`)
}

const binDirOf = (
  installer: Installer,
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  windows: boolean,
): string | null => {
  const path = windows ? win32 : posix
  const script = path.normalize(scriptPath)
  switch (installer) {
    case "npm": {
      const at = script.indexOf(path.sep + PACKAGE_DIR.join(path.sep) + path.sep)
      if (at === -1) return null
      const prefix = script.slice(0, at)
      // npm on Windows keeps commands beside `node_modules`; elsewhere in `<prefix>/bin` beside `lib`.
      return windows ? prefix : path.basename(prefix) === "lib" ? path.join(path.dirname(prefix), "bin") : null
    }
    case "bun": {
      const at = script.indexOf(`${path.sep}install${path.sep}global${path.sep}node_modules${path.sep}`)
      return at === -1 ? null : path.join(script.slice(0, at), "bin")
    }
    case "pnpm":
      return env.PNPM_HOME ? env.PNPM_HOME : null
    default:
      return null
  }
}

const firstOnPath = (
  entries: string[],
  names: string[],
  path: typeof posix,
  exists: (file: string) => boolean,
): string | null => {
  for (const dir of entries) {
    for (const name of names) {
      const file = path.join(dir, name)
      if (exists(file)) return file
    }
  }
  return null
}

/**
 * A link on Linux and macOS leads to the script; the small script npm and pnpm write instead names
 * it. Either way the package's path is the tell. bun's `max.exe` names nothing, so it is unknown.
 */
const isMaxCli = (
  command: string,
  { realpath, read }: { realpath: (file: string) => string; read: (file: string) => string },
): boolean | null => {
  const names = (text: string) => text.replaceAll("\\", "/").toLowerCase().includes(SCRIPT_TAIL)
  try {
    if (names(realpath(command))) return true
    if (command.toLowerCase().endsWith(".exe")) return null
    return names(read(command))
  } catch {
    return null
  }
}

/**
 * PowerShell on Windows, a POSIX shell elsewhere. Single quotes in both, so `$` and backticks in a
 * path need no escaping; a quote inside is doubled for PowerShell and closed-and-escaped for sh.
 */
export const pathFix = (binDir: string, windows: boolean): string[] => {
  if (!windows) return [`export PATH='${binDir.replaceAll("'", `'\\''`)}':"$PATH"`]
  const quoted = `'${binDir.replaceAll("'", "''")}'`
  return [
    `$env:Path = ${quoted} + ';' + $env:Path`,
    `[Environment]::SetEnvironmentVariable('Path', ${quoted} + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')`,
  ]
}

/** A command shim is a few hundred bytes; another program called `max` may be megabytes. */
const head = (file: string): string => {
  const descriptor = openSync(file, "r")
  try {
    const buffer = Buffer.alloc(4096)
    return buffer.toString("utf8", 0, readSync(descriptor, buffer, 0, buffer.length, 0))
  } finally {
    closeSync(descriptor)
  }
}
