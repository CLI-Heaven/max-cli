import { captureStreams, memoryKeyring } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import type { Environment } from "./commands/context.js"
import { toPoll } from "./domain/map.js"
import { Opcode } from "./generated/opcodes.generated.js"
import { run } from "./program.js"
import { Connection } from "./protocol/connection.js"
import { pollLines } from "./rendering/messages.js"
import { SendJournal, sendsPathFor } from "./sends/journal.js"
import { SessionStore } from "./session/store.js"
import { mockMax } from "./testing/mock-max.js"

const OWNER = 10000001
const MESSAGE = "116762160362694583"
const MULTIPLE = 2
const REVOTE = 4
const CLOSED = 8

const pollAttach = ({ settings = 0, mine = false, version = 1 } = {}) => ({
  _type: "POLL",
  pollId: 900,
  version,
  title: "Lunch?",
  settings,
  answers: [
    { answerId: 1, text: "Yes" },
    { answerId: 2, text: "No" },
  ],
  state: {
    total: 3,
    result: [
      { answerId: 1, voteCount: 2, options: mine ? 1 : 0 },
      { answerId: 2, voteCount: 1, options: 0 },
    ],
  },
})

const messenger = ({ attach = pollAttach(), sender = OWNER } = {}) => {
  const max = mockMax({
    answers: {
      [Opcode.SESSION_INIT]: {},
      [Opcode.LOGIN]: {
        profile: { contact: { id: OWNER } },
        chats: [{ id: 111, title: "Friends", type: "CHAT", lastEventTime: 1789776000000 }],
      },
      [Opcode.CHAT_HISTORY]: {
        messages: [{ id: BigInt(MESSAGE), time: 1789776000000, sender, text: "", attaches: [attach] }],
      },
      [Opcode.SEND_VOTE]: {
        state: {
          total: 4,
          result: [
            { answerId: 1, voteCount: 3, options: 1 },
            { answerId: 2, voteCount: 1 },
          ],
        },
      },
      [Opcode.MSG_EDIT]: {
        message: {
          id: BigInt(MESSAGE),
          time: 1789776000000,
          sender,
          text: "",
          attaches: [{ ...attach, settings: (attach.settings ?? 0) | CLOSED }],
        },
      },
      [Opcode.MSG_SEND]: {
        message: { id: 116762160362694590n, time: 1789776100000, sender: OWNER, text: "", attaches: [pollAttach()] },
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
  const sentWith = (opcode: number) => max.sent.filter((request) => request.opcode === opcode)
  return { environment, sentWith }
}

const runWith = async (argv: string[], environment: Environment) => {
  const streams = captureStreams()
  const code = await run([...argv, "--json"], { ...environment, streams, tty: false })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

const journalOf = (profile: string) => new SendJournal(sendsPathFor(profile)).entries()

describe("reading a poll", () => {
  it("unpacks the settings bits and marks the owner's own answer", () => {
    expect(toPoll(pollAttach({ settings: MULTIPLE | CLOSED, mine: true }))).toEqual({
      id: "900",
      question: "Lunch?",
      answers: [
        { id: "1", text: "Yes", votes: 2, mine: true },
        { id: "2", text: "No", votes: 1, mine: false },
      ],
      total: 3,
      multiple: true,
      anonymous: false,
      revote: false,
      closed: true,
      quiz: false,
    })
  })

  it("reads nothing from a version the web client cannot show either", () => {
    expect(toPoll(pollAttach({ version: 2 }))).toBeUndefined()
  })

  it("prints the answer ids `polls vote` takes, the votes, and a tick on the owner's own", () => {
    const poll = toPoll(pollAttach({ settings: CLOSED, mine: true }))
    expect(poll && pollLines(poll)).toEqual(["📊 Lunch?", "  [1] Yes — 2 ✓", "  [2] No — 1", "  3 voted · closed"])
  })
})

describe("voting", () => {
  it("sends exactly the web client's request, and journals it as a poll write", async () => {
    const { environment, sentWith } = messenger()
    const voted = await runWith(["p-vote", "polls", "vote", "111", MESSAGE, "1"], environment)

    expect(voted.code).toBe(0)
    expect(sentWith(Opcode.SEND_VOTE).map(({ payload }) => payload)).toEqual([
      { chatId: 111, messageId: BigInt(MESSAGE), pollId: 900, answersIds: [1] },
    ])
    expect(JSON.parse(voted.stdout).poll.answers[0]).toMatchObject({ votes: 3, mine: true })
    expect(journalOf("p-vote")).toMatchObject([{ chatId: "111", kind: "poll", outcome: "sent" }])
  })

  it("takes a vote back with an empty choice", async () => {
    const { environment, sentWith } = messenger({ attach: pollAttach({ settings: REVOTE, mine: true }) })
    expect((await runWith(["p-retract", "polls", "vote", "111", MESSAGE, "--retract"], environment)).code).toBe(0)
    expect(sentWith(Opcode.SEND_VOTE)[0]?.payload).toMatchObject({ answersIds: [] })
  })

  it("refuses what the web client refuses, without asking MAX", async () => {
    const refusals = [
      { attach: pollAttach(), argv: ["1", "2"], says: "takes one answer" },
      { attach: pollAttach({ settings: CLOSED }), argv: ["1"], says: "is closed" },
      { attach: pollAttach({ mine: true }), argv: ["2"], says: "does not let a vote change" },
      { attach: pollAttach(), argv: ["7"], says: "has no answer 7" },
    ]
    for (const [index, { attach, argv, says }] of refusals.entries()) {
      const { environment, sentWith } = messenger({ attach })
      const refused = await runWith([`p-refuse-${index}`, "polls", "vote", "111", MESSAGE, ...argv], environment)
      expect(refused.code).toBe(2)
      expect(JSON.parse(refused.stderr).error.message).toContain(says)
      expect(sentWith(Opcode.SEND_VOTE)).toEqual([])
    }
  })
})

describe("closing and creating", () => {
  it("closes by editing the message with the closed bit raised and the answers' text only", async () => {
    const { environment, sentWith } = messenger({ attach: pollAttach({ settings: MULTIPLE }) })
    const closed = await runWith(["p-close", "polls", "close", "111", MESSAGE], environment)

    expect(closed.code).toBe(0)
    expect(sentWith(Opcode.MSG_EDIT)[0]?.payload).toEqual({
      chatId: 111,
      messageId: BigInt(MESSAGE),
      attachments: [
        { _type: "POLL", pollId: 900, title: "Lunch?", answers: [{ text: "Yes" }, { text: "No" }], settings: 10 },
      ],
    })
    expect(JSON.parse(closed.stdout).poll.closed).toBe(true)
  })

  it("refuses to close somebody else's poll", async () => {
    const { environment, sentWith } = messenger({ sender: 20000002 })
    expect((await runWith(["p-theirs", "polls", "close", "111", MESSAGE], environment)).code).toBe(2)
    expect(sentWith(Opcode.MSG_EDIT)).toEqual([])
  })

  it("creates a poll as a message whose one attachment is the poll", async () => {
    const { environment, sentWith } = messenger()
    const argv = ["p-create", "polls", "create", "111", "Lunch?", "Yes", "No", "--multiple", "--revote"]
    expect((await runWith(argv, environment)).code).toBe(0)
    expect(sentWith(Opcode.MSG_SEND)[0]?.payload).toMatchObject({
      message: {
        attaches: [
          { _type: "POLL", title: "Lunch?", answers: [{ text: "Yes" }, { text: "No" }], settings: MULTIPLE | REVOTE },
        ],
      },
    })
    expect(journalOf("p-create")).toMatchObject([{ chatId: "111", kind: "poll", outcome: "sent" }])
  })
})
