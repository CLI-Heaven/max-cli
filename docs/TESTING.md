# Testing

How to check this yourself, and what each check is actually for. Nothing here describes a test that
has not been run.

```sh
pnpm test        # vitest — 57 tests
pnpm lint        # biome: format, lint, and the commands/protocol seam
pnpm typecheck   # tsc --build
pnpm build
pnpm smoke:bun   # the built command, executed under Bun
```

CI runs all of them plus a secret scan over the whole history —
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

---

## The rule: a skip is not a pass

A skipped test, a mocked-away assertion and a test that would pass with the feature deleted all
report green. When reporting work done, say which suite ran and paste the counts.

## MAX is never contacted by the suite

`src/testing/mock-max.ts` scripts the service: answers per opcode, refusals, and **silence**, which
is how a timeout is tested without waiting for one. No timers, no network, no delay option.

It records every request, and that is what turns two promises into tests:

```ts
expect(max.sent.map((call) => call.opcode)).not.toContain(Opcode.CHAT_MARK)  // reading marks nothing read
expect(sends.map((call) => call.payload.message.cid)).toEqual([4242, 4242])   // a retry reuses the cid
```

An opcode with no scripted answer is recorded in `max.unexpected`, so a client that asks for
something the test did not expect cannot pass for the wrong reason.

## No test touches a real keychain

The keyring is one injected function from `cli-core`, replaced by `memoryKeyring()` in every test.
Setting a config directory would be necessary but not sufficient — one test that forgets it writes
to the developer's actual keychain. The seam makes it impossible rather than discouraged.

## The live checks, and why they are not tests

There is no automated suite against the real MAX, and there should not be: it needs a real account,
a live token, and it writes messages. What exists instead is a set of probes run by hand, whose
results are recorded in [`ARCHITECTURE.md`](ARCHITECTURE.md) with the date they were measured —
deduplication by `cid`, 18-digit message ids, `chatsCount` bounds, contact coverage.

When you re-run one, update the sentence it supports. A measurement nobody can replay is a rumour,
and a measurement that has quietly stopped being true is worse.

To drive the CLI against a real account without touching your own config:

```sh
export MAX_CONFIG_DIR=/tmp/max-probe/config MAX_STATE_DIR=/tmp/max-probe/state
MAX_TOKEN="$(cat /path/to/token)" node dist/bin/max.js login --json
node dist/bin/max.js chats --json --limit 5
```

The token goes in a file and into the environment — never on a command line, where `ps` and shell
history can see it.

## What to write

Prefer the test that pins a contract someone could plausibly break over the one that restates the
implementation. The ones worth having here are the mismatched pairs: reading history must not mark
anything read; a retried send must reuse its `cid`; a send with no answer must be
`outcome_unknown`, never failed and never sent; an ambiguous chat name must refuse rather than pick.

Both defects found so far were found this way — a device identity that changed on every call, and
two sends in the same millisecond sharing a `cid`. Neither would have been visible from the outside
until it cost something.
