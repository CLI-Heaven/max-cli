import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { LOGIN_PAUSES_MS, SessionStore, withLoginRefused, withoutLoginPause } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const RATE_LIMITED = 8

const LOGIN = {
  profile: { contact: { id: 10000001 } },
  chats: [{ id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 }],
}

const messenger = (refusal?: string) => {
  let sockets = 0
  const max = mockMax({
    answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: LOGIN, [Opcode.CONTACT_INFO]: { contacts: [] } },
    refuse: refusal === undefined ? {} : { [Opcode.LOGIN]: refusal },
  })
  const keyring = memoryKeyring()
  const stores = new Map<string, SessionStore>()
  const store = (profile: string) => {
    const existing = stores.get(profile)
    if (existing) return existing
    const created = new SessionStore({ profile, keyring })
    created.writeToken("a-token")
    stores.set(profile, created)
    return created
  }
  const environment: Environment = {
    store,
    connection: () =>
      new Connection({
        createSocket: () => {
          sockets += 1
          return max.createSocket()
        },
        timeoutMs: 50,
      }),
  }
  return { environment, store, sockets: () => sockets }
}

const runWith = async (argv: string[], environment: Environment) => {
  const streams = captureStreams()
  const code = await run([...argv, "--json"], { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

describe("a login MAX refuses for too many attempts", () => {
  it("exits rate_limited, and the next run refuses by itself without opening a socket", async () => {
    const { environment, store, sockets } = messenger("error.limit.violate: Слишком много попыток")

    const first = await runWith(["l-limit", "chats", "list"], environment)
    const second = await runWith(["l-limit", "chats", "list"], environment)

    expect(first.code).toBe(RATE_LIMITED)
    expect(first.stdout).toBe("")
    expect(JSON.parse(first.stderr)).toMatchObject({ error: { code: "rate_limited" } })
    expect(first.stderr).toContain("will not log in again before")
    expect(store("l-limit").readState()).toMatchObject({ loginRefusals: 1, loginPausedUntil: expect.any(String) })
    expect(second.code).toBe(RATE_LIMITED)
    expect(sockets()).toBe(1)
  })

  it("keeps a refused token an authentication problem", async () => {
    const { environment } = messenger("login.token: token expired")
    expect((await runWith(["l-token", "chats", "list"], environment)).code).toBe(4)
  })

  it("refuses `session start` inside the pause, before asking MAX anything", async () => {
    const { environment, store, sockets } = messenger()
    const profile = store("l-start")
    profile.writeState({ ...withLoginRefused({ ...profile.readState(), logins: 3 }) })

    const { code } = await runWith(["l-start", "session", "start"], { ...environment, tty: false })

    expect(code).toBe(RATE_LIMITED)
    expect(sockets()).toBe(0)
  })

  it("logs in again once the pause is over, and a login that works clears it", async () => {
    const { environment, store } = messenger()
    const profile = store("l-over")
    profile.writeState(withLoginRefused({ ...profile.readState(), loginRefusals: 2 }, Date.now() - 24 * 3_600_000))

    expect((await runWith(["l-over", "chats", "list"], environment)).code).toBe(0)
    expect(profile.readState()).not.toHaveProperty("loginPausedUntil")
    expect(profile.readState()).not.toHaveProperty("loginRefusals")
  })

  it("waits longer after each refusal in a row: 1 min, 5 min, 30 min, 1 h, 6 h, then 24 h", () => {
    let state = withoutLoginPause({ deviceId: "d", logins: 1 })
    const waits: number[] = []
    for (let refusal = 0; refusal < 7; refusal += 1) {
      state = withLoginRefused(state, 0)
      waits.push(Date.parse(String(state.loginPausedUntil)) / 60_000)
    }
    expect(waits).toEqual([1, 5, 30, 60, 360, 1440, 1440])
    expect(LOGIN_PAUSES_MS).toHaveLength(6)
  })
})
