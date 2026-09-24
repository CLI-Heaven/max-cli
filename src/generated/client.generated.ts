// Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`.
import type { Payload } from "../protocol/frame.js"
import type { Operation, RequestOf } from "../spec/define.js"
import { OPERATIONS } from "./operations.generated.js"

export type Invoke = <TOperation extends Operation>(
  operation: TOperation,
  request: RequestOf<TOperation>,
) => Promise<Payload>

/**
 * The wire surface: one typed call per operation, and nothing else.
 *
 * **It is internal.** Everything it returns is a raw MAX payload, with none of the rules that make
 * this tool safe to point at a real account — the resend policy, the name filling, the conversion
 * that keeps a 64-bit id from being read as a number. `MaxClient` is the only public door
 * (`NEED-34`).
 */
export const wireClient = (invoke: Invoke) => ({
  session: {
    init: (request: RequestOf<(typeof OPERATIONS)["session.init"]>) => invoke(OPERATIONS["session.init"], request),
    login: (request: RequestOf<(typeof OPERATIONS)["session.login"]>) => invoke(OPERATIONS["session.login"], request),
  },
  contacts: {
    info: (request: RequestOf<(typeof OPERATIONS)["contacts.info"]>) => invoke(OPERATIONS["contacts.info"], request),
  },
  chats: {
    history: (request: RequestOf<(typeof OPERATIONS)["chats.history"]>) => invoke(OPERATIONS["chats.history"], request),
    list: (request: RequestOf<(typeof OPERATIONS)["chats.list"]>) => invoke(OPERATIONS["chats.list"], request),
  },
  messages: {
    send: (request: RequestOf<(typeof OPERATIONS)["messages.send"]>) => invoke(OPERATIONS["messages.send"], request),
    react: (request: RequestOf<(typeof OPERATIONS)["messages.react"]>) => invoke(OPERATIONS["messages.react"], request),
    reactions: (request: RequestOf<(typeof OPERATIONS)["messages.reactions"]>) =>
      invoke(OPERATIONS["messages.reactions"], request),
  },
  attachments: {
    video: (request: RequestOf<(typeof OPERATIONS)["attachments.video"]>) =>
      invoke(OPERATIONS["attachments.video"], request),
    file: (request: RequestOf<(typeof OPERATIONS)["attachments.file"]>) =>
      invoke(OPERATIONS["attachments.file"], request),
  },
})

export type WireClient = ReturnType<typeof wireClient>
