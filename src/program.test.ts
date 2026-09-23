import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { resolveSettings } from "./config.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { commandWords, liftProfile } from "./profile.js"
import { createProgram, run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

/** A MAX that answers a login and one history read, and a keyring that holds a token or not. */
const scriptedMax = ({ token = true } = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [{ id: 111, title: "First", type: "CHAT", lastEventTime: 1789776000000 }],
      },
      [Opcode.CHAT_HISTORY]: {
        messages: [{ id: 116762160362694583n, time: 1789776000000, sender: 10000002, text: "hi", attaches: [] }],
      },
      // The sender is in no chat the login named, so naming them costs this request — a group
      // member is looked up now, not only the other half of a dialog. Left unscripted it does not
      // fail: the client waits, gives up and says "shown by id" on stderr, which is correct of it
      // and looks like a broken assertion from here.
      [Opcode.CONTACT_INFO]: {
        contacts: [{ id: 10000002, names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
      },
    },
  })
  const keyring = memoryKeyring()
  return {
    max,
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      if (token) store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  }
}

/**
 * A login that carries a `time`, so the store takes its memberships, and a group and a dialog to
 * look into. Each test names its own profile: they share one sandboxed cache directory.
 */
const acquaintedMax = () => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        time: 1789776000000,
        profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } },
        chats: [
          {
            id: 111,
            title: "First",
            type: "CHAT",
            newMessages: 2,
            lastEventTime: 1789776000000,
            participants: { 10000001: 1, 10000002: 1, 10000003: 1 },
          },
          {
            id: 222,
            type: "DIALOG",
            newMessages: 0,
            lastEventTime: 1789775000000,
            participants: { 10000001: 1, 10000002: 1 },
          },
        ],
        contacts: [{ id: 10000002, link: "someone", names: [{ name: "Someone Else", type: "FULL_NAME" }] }],
      },
      [Opcode.CONTACT_INFO]: { contacts: [{ id: 10000003, names: [{ name: "Another Person", type: "FULL_NAME" }] }] },
      // As MAX answers a forward read: starting with the message it was given, whose id holds its time.
      [Opcode.CHAT_HISTORY]: {
        messages: [
          { id: 116762160362694583n, time: 1781649175456, sender: 10000002, text: "anchor", attaches: [] },
          { id: 116762160362694584n, time: 1781649175457, sender: 10000002, text: "later", attaches: [] },
          { id: 116762160362694585n, time: 1781649175458, sender: 10000002, text: "latest", attaches: [] },
        ],
      },
    },
  })
  const keyring = memoryKeyring()
  const environment: Environment = {
    store: (profile: string) => {
      const store = new SessionStore({ profile, keyring })
      store.writeToken("a-token")
      return store
    },
    connection: () => new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
  }
  return { max, environment }
}

const runWith = async (argv: string[], environment: Environment = {}) => {
  const streams = captureStreams()
  const code = await run(argv, { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

describe("the program", () => {
  it("prints a version, and prints it on stdout", async () => {
    const { stdout, stderr, code } = await runWith(["--version"])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(stderr).toBe("")
    expect(code).toBe(0)
  })

  it("is called max, whatever the package is called", async () => {
    expect((await runWith(["--help"])).stdout).toContain("Usage: max")
  })

  it("offers every resource at the top level", async () => {
    const { stdout } = await runWith(["--help"])
    for (const command of ["session", "account", "chats", "contacts", "messages", "cache", "runs"]) {
      expect(stdout).toContain(command)
    }
  })

  it("**offers a way out of the cache**, because a cache is the one part that remembers being wrong", async () => {
    expect((await runWith(["--help"])).stdout).toContain("--offline")
    expect((await runWith(["cache", "--help"])).stdout).toContain("clear")
  })

  it("**does not offer --no-cache**, because not using the record is already what happens", async () => {
    expect((await runWith(["--help"])).stdout).not.toContain("--no-cache")
  })

  it("reads --offline as a switch the commands can see", () => {
    const program = createProgram()
    program.parseOptions(["--offline"])
    expect(program.opts().offline).toBe(true)

    const untouched = createProgram()
    untouched.parseOptions([])
    expect(untouched.opts().offline).toBeUndefined()
  })

  it("reads a run back three ways, and records nothing while doing it", async () => {
    const { stdout } = await runWith(["runs", "--help"])
    for (const action of ["list", "show", "path"]) expect(stdout).toContain(action)
  })

  it("**tells `--record`, `--no-record` and neither apart**, because the third is the configuration's", () => {
    const asked = createProgram()
    asked.parseOptions(["--record"])
    expect(asked.opts().record).toBe(true)

    const refused = createProgram()
    refused.parseOptions(["--no-record"])
    expect(refused.opts().record).toBe(false)

    // Not `true` and not `false`: nothing on the command line means the configuration file decides,
    // and a default here would quietly outrank it.
    const untouched = createProgram()
    untouched.parseOptions([])
    expect(untouched.opts().record).toBeUndefined()
  })

  it("promises only what `--trace` actually does", async () => {
    // `commander` wraps the column, so the promise is checked in the piece that survives wrapping.
    const { stdout } = await runWith(["--help"])
    expect(stdout).toContain("ids and timings")
    // It said "without anything that identifies you" until 2026-09-20, and the line names the chat.
    expect(stdout).not.toContain("without anything that identifies you")
  })

  it("**puts the action under the resource, never beside it**", async () => {
    const messages = await runWith(["messages", "--help"])
    expect(messages.stdout).toContain("list")
    expect(messages.stdout).toContain("send")

    // `max send` was a top-level command until 2026-09-19. One rule, no exceptions to remember.
    const gone = await runWith(["send", "0", "hello"])
    expect(gone.stderr).toContain("unknown command")
    expect(gone.code).not.toBe(0)
  })

  it("keeps a subcommand from killing the process on a bad option", async () => {
    const { stdout, stderr, code } = await runWith(["chats", "list", "--nonsense"])
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown option")
    expect(code).not.toBe(0)
  })

  it("counts -v, gives the version to -V, and turns -vv into the second level", async () => {
    expect((await runWith(["-V"])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(resolveSettings({ verbose: 2 }, { env: {} }).detail).toBe(2)
    expect(resolveSettings({ verbose: 5 }, { env: {} }).detail).toBe(2)

    const program = createProgram()
    program.parseOptions(["-vv"])
    expect(program.opts().verbose).toBe(2)
  })

  it("carries the global options every command needs", async () => {
    const { stdout } = await runWith(["--help"])
    for (const option of ["--json", "--jsonl", "--quiet", "--verbose", "--trace"]) expect(stdout).toContain(option)
  })

  it("**has no `--profile`, and says in its help where the profile went**", async () => {
    const { stdout } = await runWith(["--help"])
    expect(stdout).not.toContain("--profile")
    expect(stdout).toContain("max [profile]")
    expect(stdout).toContain("The first word is the profile")
    expect(stdout).toContain("MAX_PROFILE")
  })

  it("offers `--silent` on a send and nowhere else", async () => {
    const send = await runWith(["messages", "send", "--help"])
    expect(send.stdout).toContain("--silent")

    // Reading is observational; there is nothing to notify anybody about, and a flag that does
    // nothing on half the commands is a flag people learn to distrust.
    const list = await runWith(["messages", "list", "--help"])
    expect(list.stdout).not.toContain("--silent")
  })

  it("**refuses a search shorter than the index can answer**, instead of printing an empty list", async () => {
    // A trigram index returns nothing for one or two characters rather than complaining, and an
    // empty list is indistinguishable from "no matches". Measured 2026-09-22.
    const { code, stderr } = await runWith(["chats", "list", "--search", "ив"])
    expect(code).not.toBe(0)
    expect(stderr).toContain("3 characters")
  })

  it("refuses an unknown --kind by name, rather than answering with nothing", async () => {
    const { code, stderr } = await runWith(["chats", "list", "--kind", "chanel"])
    expect(code).not.toBe(0)
    expect(stderr).toContain("dialog, group or channel")
  })

  it("offers searching as an action under `messages`, with the same shape as the rest", async () => {
    const { stdout } = await runWith(["messages", "--help"])
    expect(stdout).toContain("search")

    const search = await runWith(["messages", "search", "--help"])
    expect(search.stdout).toContain("--chat")
    expect(search.stdout).toContain("already read")
  })

  it("**refuses a chat name on a search**, because resolving one would need a login", async () => {
    const { code, stderr } = await runWith(["messages", "search", "hello", "--chat", "Иван"])
    expect(code).not.toBe(0)
    expect(stderr).toContain("chat id")
  })

  it("**refuses `--timeout` without a unit**, because the neighbouring setting is milliseconds", async () => {
    const { code, stderr } = await runWith(["--timeout", "30", "chats", "list"])
    expect(code).not.toBe(0)
    expect(stderr).toContain("30s, 2m or 500ms")
  })

  it("offers --timeout at the top level, where every command can be given one", async () => {
    const { stdout } = await runWith(["--help"])
    expect(stdout).toContain("--timeout <duration>")
    expect(stdout).toContain("whole command")
  })

  it("offers `config show`, so the settings in force can be read without guessing", async () => {
    const { stdout } = await runWith(["--help"])
    expect(stdout).toContain("config")

    const show = await runWith(["config", "--help"])
    expect(show.stdout).toContain("show")
    expect(show.stdout).toContain("where each one came from")
  })

  describe("what a command prints", () => {
    it("`config show --json` answers one object on stdout", async () => {
      const { stdout, code } = await runWith(["config", "show", "--json"])
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({ profile: "default", configFound: false })
    })

    it("`skill show` prints the skill file itself", async () => {
      const { stdout } = await runWith(["skill", "show"])
      expect(stdout.startsWith("---\nname: max-cli")).toBe(true)
    })

    it("`messages list` reads a scripted MAX and answers the listing, and marks nothing read", async () => {
      const { max, ...environment } = scriptedMax()
      const { stdout, stderr, code } = await runWith(["messages", "list", "111", "--limit", "5", "--json"], environment)

      // ⚠ **First, so the failure names its cause.** This test went red when sender naming began
      // asking `CONTACT_INFO` that nothing scripted; the mock stayed silent, the client waited,
      // gave up and said "shown by id" — and what failed was the `stderr` line below, which
      // reports a symptom three steps downstream. Asserted here, the message is the opcode.
      expect(max.unexpected).toEqual([])

      expect(stderr).toBe("")
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({
        items: [{ id: "116762160362694583", text: "hi", senderName: "Someone Else" }],
        hasMore: false,
      })
      expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
    })

    it("`--jsonl` writes one object per line and nothing else", async () => {
      const { max: _, ...environment } = scriptedMax()
      const { stdout } = await runWith(["messages", "list", "111", "--jsonl"], environment)
      expect(stdout.split("\n").map((line) => JSON.parse(line).id)).toEqual(["116762160362694583"])
    })

    it("**leaves stdout empty on a failure** — no session, nothing printed but the error", async () => {
      const { max: _, ...environment } = scriptedMax({ token: false })
      const { stdout, stderr, code } = await runWith(["account", "show", "--json"], environment)
      expect(stdout).toBe("")
      expect(JSON.parse(stderr).error.code).toBe("authentication_error")
      expect(code).toBe(4)
    })
  })

  describe("reading without sending anything", () => {
    it("`chats list --unread` answers only the chats with something unread", async () => {
      const { max, environment } = acquaintedMax()
      const { stdout, code } = await runWith(["t-unread", "chats", "list", "--unread", "--json"], environment)

      expect(max.unexpected).toEqual([])
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({ items: [{ id: "111", unreadCount: 2 }], hasMore: false })
    })

    it("`messages list --after` reads forward from the message, leaves it out, and names the next page", async () => {
      const { max, environment } = acquaintedMax()
      const { stdout, stderr, code } = await runWith(
        ["t-after", "messages", "list", "111", "--after", "116762160362694583", "--limit", "1", "--jsonl"],
        environment,
      )

      expect(max.unexpected).toEqual([])
      expect(code).toBe(0)
      expect(JSON.parse(stdout).id).toBe("116762160362694584")
      expect(stderr).toContain("--after 116762160362694584")

      const history = max.sent.find((call) => call.opcode === Opcode.CHAT_HISTORY)?.payload
      expect(history).toMatchObject({ from: Number(116762160362694583n >> 16n), forward: 2, backward: 0 })
      expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)
    })

    it("**refuses `--after` with `--before`** before connecting to anything", async () => {
      const { max, environment } = acquaintedMax()
      const { code, stderr } = await runWith(
        ["t-both", "messages", "list", "111", "--after", "2026-09-20T00:00:00Z", "--before", "2026-09-21T00:00:00Z"],
        environment,
      )

      expect(code).toBe(2)
      expect(stderr).toContain("two directions")
      expect(max.sent).toEqual([])
    })

    it("blames `--after` for a value that is neither an id nor a time", async () => {
      const { environment } = acquaintedMax()
      const { code, stderr } = await runWith(["t-bad", "messages", "list", "111", "--after", "tuesday"], environment)

      expect(code).toBe(2)
      expect(stderr).toContain("--after takes a message id")
    })

    it("`chats show` answers one chat with its members, and refuses an id that is not a chat", async () => {
      const { max, environment } = acquaintedMax()
      const shown = await runWith(["t-show", "chats", "show", "First", "--json"], environment)

      expect(max.unexpected).toEqual([])
      expect(shown.code).toBe(0)
      expect(JSON.parse(shown.stdout)).toMatchObject({
        id: "111",
        kind: "group",
        unreadCount: 2,
        members: [{ name: "Another Person" }, { name: "Someone Else", username: "someone" }],
      })

      const missing = await runWith(["t-show", "chats", "show", "999", "--json"], environment)
      expect(JSON.parse(missing.stderr).error.code).toBe("not_found")
      expect(missing.stdout).toBe("")
    })

    it("`contacts show` finds a person by @username, with every chat shared, and refuses an ambiguous name", async () => {
      const { max, environment } = acquaintedMax()
      const shown = await runWith(["t-person", "contacts", "show", "@someone", "--json"], environment)

      expect(max.unexpected).toEqual([])
      expect(shown.code).toBe(0)
      expect(JSON.parse(shown.stdout)).toMatchObject({
        id: "10000002",
        name: "Someone Else",
        chats: [
          { id: "111", kind: "group" },
          { id: "222", kind: "dialog" },
        ],
      })

      const group = await runWith(["t-person", "contacts", "show", "another", "--json"], environment)
      expect(JSON.parse(group.stdout)).toMatchObject({ id: "10000003", chats: [{ id: "111" }] })

      const ambiguous = await runWith(["t-person", "contacts", "show", "on", "--json"], environment)
      expect(ambiguous.code).toBe(2)
      expect(JSON.parse(ambiguous.stderr).error.candidates).toHaveLength(2)
    })

    it("**`--offline` reaches the command**: it answers from the record and never connects", async () => {
      const { environment } = acquaintedMax()
      await runWith(["t-offline", "chats", "list", "--json"], environment)

      const silent = acquaintedMax()
      const offline = await runWith(["t-offline", "chats", "show", "First", "--offline", "--json"], silent.environment)
      expect(offline.code).toBe(0)
      expect(JSON.parse(offline.stdout)).toMatchObject({ id: "111" })

      const send = await runWith(["t-offline", "messages", "send", "111", "hi", "--offline"], silent.environment)
      expect(send.code).not.toBe(0)
      expect(silent.max.sent).toEqual([])
    })
  })

  it("does not mistake a command for a profile", () => {
    const program = createProgram()
    expect(liftProfile(["chats", "list"], commandWords(program)).profile).toBeUndefined()
    expect(liftProfile(["personal", "chats", "list"], commandWords(program)).profile).toBe("personal")
  })

  it("sends an unknown option to stderr and exits non-zero", async () => {
    const { stdout, stderr, code } = await runWith(["--nonsense"])
    expect(stdout).toBe("")
    expect(stderr).toContain("unknown option")
    expect(code).not.toBe(0)
  })

  it("**puts a failure on stderr as JSON, never on stdout**", async () => {
    const { stdout, stderr, code } = await runWith(["a-profile-that-does-not-exist", "account", "show", "--json"])

    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("authentication_error")
    // 4 is authentication_error in cli-core's table: a script branches on this, not on the text.
    expect(code).toBe(4)
  })

  it("tells a person what to do next, **naming the profile they actually typed**", async () => {
    const streams = captureStreams()
    const code = await run(["a-profile-that-does-not-exist", "account", "show"], { streams, tty: true })

    expect(streams.stdout).toEqual([])
    expect(streams.stderr.join("")).toContain("max a-profile-that-does-not-exist session start")
    expect(code).toBe(4)
  })

  it("**refuses a profile with no command instead of printing help on stdout**", async () => {
    // `max me` — renamed away on 2026-09-19 — is now the profile `me` and nothing else. Commander
    // answers a missing command with help on stdout, which a script cannot tell from a result.
    const { stdout, stderr, code } = await runWith(["me"])

    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("validation_error")
    expect(JSON.parse(stderr).error.message).toContain("read as a profile name")
    expect(code).toBe(2)
  })

  it("explains itself when the first word was a mistyped command", async () => {
    // `max chat list` — one letter short. Without this line the only message is "unknown command
    // 'list'", which names the wrong word entirely.
    const { stderr, code } = await runWith(["chat", "list"])

    expect(stderr).toContain("unknown command 'list'")
    expect(stderr).toContain('"chat" is not a command, so it was read as a profile name')
    expect(code).not.toBe(0)
  })
})
