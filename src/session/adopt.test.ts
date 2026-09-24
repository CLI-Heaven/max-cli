import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { MaxClient } from "../client.js"
import { Opcode } from "../generated/opcodes.generated.js"
import { Connection } from "../protocol/connection.js"
import { mockMax } from "../testing/mock-max.js"
import { adoptToken } from "./adopt.js"
import { SessionStore } from "./store.js"

const loginAnswer = { profile: { contact: { id: 10000001, names: [{ name: "Test Person", type: "FULL_NAME" }] } } }

const setup = (max: ReturnType<typeof mockMax>, existing?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "max-cli-"))
  const store = new SessionStore({
    keyring: memoryKeyring(),
    configDir: dir,
    stateDir: join(dir, "state"),
    env: {},
  })
  if (existing) store.writeToken(existing)

  return {
    store,
    client: new MaxClient({
      store,
      connection: new Connection({ createSocket: max.createSocket, timeoutMs: 50 }),
      warn: () => {},
    }),
  }
}

describe("adoptToken", () => {
  it("**keeps the token the login answered with, not the one that was pasted in**", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { ...loginAnswer, token: "the-rotated-one" } },
    })
    const { client, store } = setup(max)

    await adoptToken(client, store, "the-pasted-one")

    // Writing the pasted token here unconditionally would replace the fresher one `connect` kept.
    expect(store.readToken()).toBe("the-rotated-one")
    await client.close()
  })

  it("falls back to the pasted token when the login returned none", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = setup(max)

    await adoptToken(client, store, "the-pasted-one")
    expect(store.readToken()).toBe("the-pasted-one")
    await client.close()
  })

  it("**keeps the working token when the new one is refused** — a keyring entry cannot be read back", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {} }, refuse: { [Opcode.LOGIN]: "login.token" } })
    const { client, store } = setup(max, "the-working-token")

    await expect(adoptToken(client, store, "a-typo")).rejects.toThrow()
    expect(store.readToken()).toBe("the-working-token")
    await client.close()
  })

  it("stores the token once MAX has accepted it", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = setup(max)

    await adoptToken(client, store, "a-good-token")
    expect(store.readToken()).toBe("a-good-token")
    await client.close()
  })

  it("**replaces the token a profile already had** once MAX has accepted the new one", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = setup(max, "the-old-token")

    await adoptToken(client, store, "the-new-token")
    expect(store.readToken()).toBe("the-new-token")
    await client.close()
  })

  it("keeps the rotated token over the offered one when the profile already had a token", async () => {
    const max = mockMax({
      answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: { ...loginAnswer, token: "the-rotated-one" } },
    })
    const { client, store } = setup(max, "the-old-token")

    await adoptToken(client, store, "the-new-token")
    expect(store.readToken()).toBe("the-rotated-one")
    await client.close()
  })

  it("logs in with the offered token, not with whatever was stored", async () => {
    const max = mockMax({ answers: { [Opcode.SESSION_INIT]: {}, [Opcode.LOGIN]: loginAnswer } })
    const { client, store } = setup(max, "the-old-token")

    await adoptToken(client, store, "the-new-token")
    expect(max.sent.find((request) => request.opcode === Opcode.LOGIN)?.payload).toMatchObject({
      token: "the-new-token",
    })
    await client.close()
  })
})
