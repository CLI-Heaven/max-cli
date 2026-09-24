import * as v from "valibot"
import { defineOperation, reserveOpcode } from "../define.js"

/**
 * How MAX hands over a token once a person has proved who they are — by QR, SMS code or password.
 * ⚠ **It is a credential**: nothing prints it, logs it or puts it in a fixture.
 */
const Issued = {
  tokenAttrs: v.optional(v.looseObject({ LOGIN: v.optional(v.looseObject({ token: v.string() })) })),
  passwordChallenge: v.optional(v.looseObject({ trackId: v.string(), hint: v.optional(v.string()) })),
}

const PYMAX = "PyMax 2.4.1 src/pymax/api/auth/service.py, GitHub 53103f0"
const DOCS = "max-api-docs/protocol/auth.md (dac4b19)"

export const loginQrRequest = defineOperation({
  name: "login.qrRequest",
  constant: "GET_QR",
  opcode: 288,
  auth: false,
  request: v.strictObject({}),
  response: v.looseObject({
    qrLink: v.string(),
    trackId: v.string(),
    pollingInterval: v.number(),
    expiresAt: v.number(),
  }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24: `session start qr` logged in", PYMAX, DOCS],
  },
})

export const loginQrStatus = defineOperation({
  name: "login.qrStatus",
  constant: "GET_QR_STATUS",
  opcode: 289,
  auth: false,
  request: v.strictObject({ trackId: v.string() }),
  response: v.looseObject({
    status: v.looseObject({ expiresAt: v.optional(v.number()), loginAvailable: v.optional(v.boolean()) }),
  }),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24: `session start qr` logged in", PYMAX, DOCS],
    notes:
      "`loginAvailable` is in PyMax only. The protocol notes say the token arrives as a push of opcode 18 instead.",
  },
})

export const loginByQr = defineOperation({
  name: "login.byQr",
  constant: "LOGIN_BY_QR",
  opcode: 291,
  auth: false,
  request: v.strictObject({ trackId: v.string() }),
  response: v.looseObject(Issued),
  provenance: {
    confidence: "measured",
    sources: ["measured against MAX 2026-09-24: `session start qr` logged in", PYMAX],
  },
})

export const loginSmsRequest = defineOperation({
  name: "login.smsRequest",
  constant: "AUTH_REQUEST",
  opcode: 17,
  auth: false,
  request: v.strictObject({ phone: v.string(), type: v.literal("START_AUTH"), language: v.string() }),
  response: v.looseObject({ token: v.string(), codeLength: v.optional(v.number()) }),
  provenance: {
    confidence: "confirmed",
    sources: [PYMAX, DOCS],
    notes:
      "Measured 2026-09-24: MAX refused the first request with a captcha demand, which only the web page can solve. So `session start sms` over our socket stops there; `sms-chrome` works.",
  },
})

export const loginSmsCode = defineOperation({
  name: "login.smsCode",
  constant: "AUTH",
  opcode: 18,
  auth: false,
  request: v.strictObject({ token: v.string(), verifyCode: v.string(), authTokenType: v.literal("CHECK_CODE") }),
  response: v.looseObject(Issued),
  provenance: { confidence: "confirmed", sources: [PYMAX, DOCS] },
})

export const loginPassword = defineOperation({
  name: "login.password",
  constant: "AUTH_LOGIN_CHECK_PASSWORD",
  opcode: 115,
  auth: false,
  request: v.strictObject({ trackId: v.string(), password: v.string() }),
  response: v.looseObject({ tokenAttrs: Issued.tokenAttrs, error: v.optional(v.string()) }),
  provenance: { confidence: "observed", sources: [PYMAX] },
})

export const qrApprove = reserveOpcode({
  name: "login.qrApprove",
  constant: "AUTH_QR_APPROVE",
  opcode: 290,
  reason:
    "The phone's side of a QR login: it lets whoever showed the code into the owner's account. A CLI logging itself in never approves anybody.",
  provenance: { confidence: "observed", sources: [PYMAX] },
})
