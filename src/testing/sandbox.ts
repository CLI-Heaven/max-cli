import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"

/**
 * **Moves the whole installation into a temporary directory, for every test file.**
 *
 * A test that drives a command reads the real configuration file and opens the real cache — and
 * opening the cache migrates it, which on a schema change means rebuilding it and throwing away
 * what the owner had. That is not a hypothetical: on 2026-09-22 a test run did exactly that to a
 * real machine, and the only reason it was noticed was a timestamp.
 *
 * It is a setup file rather than a hook in one test because the hazard belongs to any test that
 * reaches a command, not to the file that happened to find it. **`pnpm test` must not be able to
 * write anything a person owns**, and that has to be true of the next test file as well as this
 * one.
 *
 * The three variables move config, state and cache together. They also scope the keyring entry
 * (`ARCHITECTURE.md` §14) — the documented trap, which here is precisely the isolation wanted.
 *
 * `TMPDIR` points into it too, and the whole of it goes when the file is done: every test makes
 * its directories with `mkdtempSync(join(tmpdir(), …))`, and by 2026-09-23 that had left some
 * fifteen thousand of them in `/tmp` (`DEBT-3`). `os.tmpdir()` reads `TMPDIR` on every call.
 */
const sandbox = mkdtempSync(join(tmpdir(), "max-test-"))

process.env.MAX_CONFIG_DIR = join(sandbox, "config")
process.env.MAX_STATE_DIR = join(sandbox, "state")
process.env.MAX_CACHE_DIR = join(sandbox, "cache")
process.env.TMPDIR = sandbox
// Read before the keyring, so a token exported in the shell would log the suite in to the real account.
delete process.env.MAX_TOKEN

afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
