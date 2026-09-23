// Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`.

/**
 * Every opcode this project knows. **A number being here is not permission to send it** — the ones
 * marked "declared, never sent" exist so the reason they are never sent has a home, and so a test
 * asserting their absence has something real to compare against.
 */
export const Opcode = {
  SESSION_INIT: 6,
  /**
   * **Declared, never sent.** It does not read a profile, it updates one, and it refuses an empty payload. Your own
   * profile arrives with the login response, so nothing needs to send this. It is declared here so that fact keeps a
   * home.
   */
  PROFILE: 16,
  LOGIN: 19,
  /**
   * **Declared, never sent.** `max session end` forgets the token locally and tells MAX nothing. Ending the session
   * server-side would also end it for the browser tab the token came from, which is not what the command promises.
   */
  LOGOUT: 20,
  CONTACT_INFO: 32,
  /**
   * **Declared, never sent.** Nobody agrees what it is: tsmax and PyMax call it `CONTACT_LIST`; the protocol
   * documentation calls it `GET_BLOCKED`. Sent once with the owner's permission on 2026-09-20 and it exists — but it
   * refuses every payload we can guess, and one guess closed the connection. It stays unsent until somebody watches a
   * real client send it (`PROTO-1`).
   */
  UNIDENTIFIED_36: 36,
  CHAT_HISTORY: 49,
  /**
   * **Declared, never sent.** Reading is observational by construction. Marking a conversation read is a change to
   * somebody's account that no read command asked for, so 50 is declared here and never sent — and
   * `src/client.test.ts` asserts its absence from everything the client sent.
   */
  CHAT_MARK: 50,
  CHATS_LIST: 53,
  MSG_SEND: 64,
  /**
   * **Declared, never sent.** Deliberately never called. Giving this tool the ability to destroy somebody's messages,
   * in order to tidy up after a test, is a poor trade (`NEED-32`).
   */
  MSG_DELETE: 66,
  VIDEO_PLAY: 83,
  FILE_DOWNLOAD: 88,
  MSG_REACTION: 178,
} as const

export type Opcode = (typeof Opcode)[keyof typeof Opcode]
