import { describe, expect, it } from "vitest"
import { checkInstall, pathFix } from "./install.js"

const NPM_WIN = "C:\\Users\\O'Neil Smith\\AppData\\Roaming\\npm"
const WIN_SCRIPT = `${NPM_WIN}\\node_modules\\@leemour\\max-cli\\dist\\bin\\max.js`
const SHIM = '@"%~dp0\\node_modules\\@leemour\\max-cli\\dist\\bin\\max.js" %*'

const onWindows = (files: Record<string, string>, env: NodeJS.ProcessEnv, scriptPath = WIN_SCRIPT) =>
  checkInstall({
    scriptPath,
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    runtime: "node 24.19.0",
    env,
    platform: "win32",
    exists: (file) => windowsName(files, file) !== undefined,
    realpath: (file) => file,
    read: (file) => files[windowsName(files, file) ?? ""] ?? "",
  })

/** Windows file names ignore case. */
const windowsName = (files: Record<string, string>, file: string) =>
  Object.keys(files).find((name) => name.toLowerCase() === file.toLowerCase())

const onPosix = (
  platform: "linux" | "darwin",
  files: Record<string, string>,
  env: NodeJS.ProcessEnv,
  scriptPath = "/usr/local/lib/node_modules/@leemour/max-cli/dist/bin/max.js",
) =>
  checkInstall({
    scriptPath,
    execPath: "/usr/local/bin/node",
    runtime: "node 24.19.0",
    env,
    platform,
    exists: (file) => file in files,
    realpath: (file) => (files[file]?.endsWith(".js") ? files[file] : file),
    read: (file) => files[file] ?? "",
  })

describe("where max is installed and whether a terminal finds it", () => {
  it("finds npm's Windows command directory missing from PATH, and prints both PowerShell fixes", () => {
    const install = onWindows(
      { [`${NPM_WIN}\\max.cmd`]: SHIM },
      { Path: "C:\\Windows\\system32;C:\\Program Files\\nodejs\\" },
    )

    expect(install).toMatchObject({ installer: "npm", binDir: NPM_WIN, binDirOnPath: false, onPath: null })
    expect(install.fix).toEqual([
      "$env:Path = 'C:\\Users\\O''Neil Smith\\AppData\\Roaming\\npm' + ';' + $env:Path",
      "[Environment]::SetEnvironmentVariable('Path', 'C:\\Users\\O''Neil Smith\\AppData\\Roaming\\npm' + ';' + " +
        "[Environment]::GetEnvironmentVariable('Path', 'User'), 'User')",
    ])
  })

  it("matches a Windows PATH entry whatever its case, quotes or trailing backslash", () => {
    const quoted = `"${NPM_WIN.toUpperCase()}\\"`
    const install = onWindows({ [`${NPM_WIN}\\max.cmd`]: SHIM }, { PATH: `C:\\Windows;${quoted}` })

    expect(install).toMatchObject({ binDirOnPath: true, onPath: `${NPM_WIN.toUpperCase()}\\max.cmd`, fix: [] })
    expect(install.isMaxCli).toBe(true)
  })

  it("offers no PATH fix when PATH reaches max-cli through another folder, as a Node version manager's link does", () => {
    const version = "C:\\Users\\x\\AppData\\Local\\nvm\\v24.19.0"
    const install = onWindows(
      { [`${version}\\max.cmd`]: SHIM, "C:\\nvm4w\\nodejs\\max.cmd": SHIM },
      { Path: "C:\\nvm4w\\nodejs" },
      `${version}\\node_modules\\@leemour\\max-cli\\dist\\bin\\max.js`,
    )

    expect(install).toMatchObject({ binDir: version, binDirOnPath: false, isMaxCli: true, fix: [] })
  })

  it("names another program called max that comes first on PATH", () => {
    const install = onWindows(
      { "C:\\tools\\max.exe": "", [`${NPM_WIN}\\max.cmd`]: SHIM, "C:\\other\\max.cmd": "@echo other" },
      { Path: `C:\\other;${NPM_WIN}` },
    )

    expect(install).toMatchObject({ onPath: "C:\\other\\max.cmd", isMaxCli: false })
  })

  it("does not look for a global command when run through npx, but says whether one exists", () => {
    const npx =
      "C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\1a2b\\node_modules\\@leemour\\max-cli\\dist\\bin\\max.js"
    const install = onWindows({}, { Path: "C:\\Windows" }, npx)

    expect(install).toMatchObject({ installer: "npx", binDir: null, binDirOnPath: null, onPath: null, fix: [] })
  })

  it("does not claim a directory that holds no max command", () => {
    const install = onWindows(
      {},
      { Path: "C:\\Windows" },
      "C:\\project\\node_modules\\@leemour\\max-cli\\dist\\bin\\max.js",
    )

    expect(install).toMatchObject({ installer: "npm", binDir: null, fix: [] })
  })

  it.each(["linux", "darwin"] as const)(
    "on %s: <prefix>/bin beside lib, and an export line, not PowerShell",
    (platform) => {
      const script = "/home/x/.npm-global/lib/node_modules/@leemour/max-cli/dist/bin/max.js"
      const install = onPosix(platform, { "/home/x/.npm-global/bin/max": script }, { PATH: "/usr/bin:/bin" }, script)

      expect(install).toMatchObject({ binDir: "/home/x/.npm-global/bin", binDirOnPath: false, onPath: null })
      expect(install.fix).toEqual([`export PATH='/home/x/.npm-global/bin':"$PATH"`])
    },
  )

  it("on Linux, knows the max on PATH is this one by where its link leads", () => {
    const script = "/usr/local/lib/node_modules/@leemour/max-cli/dist/bin/max.js"
    const install = onPosix("linux", { "/usr/local/bin/max": script }, { PATH: "/usr/local/bin:/usr/bin" })

    expect(install).toMatchObject({ binDirOnPath: true, onPath: "/usr/local/bin/max", isMaxCli: true, fix: [] })
  })

  it("on macOS, takes pnpm's shell script for max-cli, and another max for another program", () => {
    const pnpm = '#!/bin/sh\nexec node "$basedir/../global/v11/x/node_modules/@leemour/max-cli/dist/bin/max.js" "$@"'
    expect(onPosix("darwin", { "/p/bin/max": pnpm }, { PATH: "/p/bin" }).isMaxCli).toBe(true)
    expect(onPosix("darwin", { "/opt/bin/max": "\u007fELF" }, { PATH: "/opt/bin" }).isMaxCli).toBe(false)
  })

  it("on Linux, ignores a Windows-style Path key", () => {
    const install = onPosix("linux", { "/usr/local/bin/max": "x" }, { Path: "/usr/local/bin" })

    expect(install.onPath).toBeNull()
  })

  it("quotes a single quote for sh", () => {
    expect(pathFix("/home/o'neil/bin", false)).toEqual([`export PATH='/home/o'\\''neil/bin':"$PATH"`])
  })
})
