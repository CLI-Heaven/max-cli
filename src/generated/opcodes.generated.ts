// Generated from src/spec/ by scripts/generate.ts. Do not edit; run `pnpm generate`.

/**
 * Every opcode this project knows. **A number being here is not permission to send it** — the ones
 * marked "declared, never sent" exist so the reason they are never sent has a home, and so a test
 * asserting their absence has something real to compare against.
 */
export const Opcode = {
  SESSION_INIT: 6,
  PROFILE: 16,
  AUTH_REQUEST: 17,
  AUTH: 18,
  LOGIN: 19,
  /**
   * **Declared, never sent.** `max session end` forgets the token locally and tells MAX nothing. Ending the session
   * server-side would also end it for the browser tab the token came from, which is not what the command promises.
   */
  LOGOUT: 20,
  SYNC: 21,
  CONTACT_INFO: 32,
  CONTACT_UPDATE: 34,
  /**
   * **Declared, never sent.** Nobody agrees what it is: tsmax and PyMax call it `CONTACT_LIST`; the protocol
   * documentation calls it `GET_BLOCKED`. Sent once with the owner's permission on 2026-09-20 and it exists — but it
   * refuses every payload we can guess, and one guess closed the connection. It stays unsent until somebody watches a
   * real client send it (`PROTO-1`).
   */
  UNIDENTIFIED_36: 36,
  CONTACT_INFO_BY_PHONE: 46,
  CHAT_HISTORY: 49,
  /**
   * **Declared, never sent.** Reading is observational by construction. Marking a conversation read is a change to
   * somebody's account that no read command asked for, so 50 is declared here and never sent — and
   * `src/client.test.ts` asserts its absence from everything the client sent.
   */
  CHAT_MARK: 50,
  CHATS_LIST: 53,
  CHAT_UPDATE: 55,
  MSG_SEND: 64,
  /**
   * **Declared, never sent.** Deliberately never called. Giving this tool the ability to destroy somebody's messages,
   * in order to tidy up after a test, is a poor trade (`NEED-32`).
   */
  MSG_DELETE: 66,
  MSG_EDIT: 67,
  PHOTO_UPLOAD: 80,
  VIDEO_PLAY: 83,
  FILE_UPLOAD: 87,
  FILE_DOWNLOAD: 88,
  SESSIONS_INFO: 96,
  SESSIONS_CLOSE: 97,
  AUTH_LOGIN_CHECK_PASSWORD: 115,
  MSG_REACTION: 178,
  MSG_CANCEL_REACTION: 179,
  MSG_GET_REACTIONS: 180,
  FOLDERS_GET: 272,
  FOLDERS_UPDATE: 274,
  FOLDERS_DELETE: 276,
  GET_QR: 288,
  GET_QR_STATUS: 289,
  /**
   * **Declared, never sent.** The phone's side of a QR login: it lets whoever showed the code into the owner's
   * account. A CLI logging itself in never approves anybody.
   */
  AUTH_QR_APPROVE: 290,
  LOGIN_BY_QR: 291,
} as const

export type Opcode = (typeof Opcode)[keyof typeof Opcode]
