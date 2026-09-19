import * as v from "valibot"

/**
 * The two directions an id travels, and why they are not the same schema.
 *
 * MAX ids are 64-bit. `asId` in `../protocol/frame.ts` is the read direction: whatever arrived —
 * a number when small, a bigint when not — leaves as a string, because an id is an identifier and
 * never arithmetic. The write direction did not exist, and `Number(id)` was standing in for it:
 * `Number("7268926000000000001")` is `7268926000000000000`, which is a different chat.
 *
 * `lossless-json` serialises a bigint as a bare number literal, so a `bigint` in a payload reaches
 * MAX with every digit and an id below 2^53 produces the identical bytes it does today.
 */

const WHOLE_NUMBER = /^-?\d+$/

export const toWireId = (value: string): bigint => BigInt(value)

/**
 * An id in a request we build: a domain string in, the wire form out.
 *
 * The schema is the encoder as well as the check, so there is no second place where a conversion
 * could be forgotten — `v.parse(request, { chatId: "0" })` yields `{ chatId: 0n }`.
 */
export const id = () =>
  v.pipe(v.string(), v.regex(WHOLE_NUMBER, "an id is a whole number written as a string"), v.transform(toWireId))

/**
 * An id in an answer we read. **Not the same as `id()` and not a transform**: a response schema
 * reports, it does not convert (§4.6 of the plan), and the conversion to our own string form is
 * the domain mapper's job.
 */
export const wireId = () => v.union([v.string(), v.number(), v.bigint()])
