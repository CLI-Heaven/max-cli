# Testing

How to check this yourself, and what each check is actually for. Nothing here describes a test that
has not been run.

```sh
pnpm test        # vitest
pnpm lint        # biome: format, lint, and the seam between commands and the protocol
pnpm typecheck   # the package, then the tests
pnpm build
pnpm smoke:bun   # the built command, executed under Bun
pnpm generate    # then `git diff --exit-code` — generated output must not be stale
```

CI runs all of them plus a secret scan over the whole history —
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

---

## The rule: a skip is not a pass

A skipped test, a mocked-away assertion and a test that would pass with the feature deleted all
report green. When reporting work done, say which suite ran and paste the counts.

**This is not hypothetical here.** `src/client.test.ts` asserted that reading history never sends
`CHAT_MARK` by comparing the sent opcodes against `Opcode.CHAT_MARK` — a constant that did not
exist. It compared against `undefined`, passed for any input, and was cited as a guarantee in
`ARCHITECTURE.md`. It survived a day because nothing typechecked the tests.

**So the tests are typechecked, in their own pass.** `tsconfig.json` still excludes them from the
build — `composite` with a `rootDir` of `src` would otherwise emit them into `dist` — and
`tsconfig.test.json` checks them with `noEmit`. `pnpm typecheck` runs both.

⚠ It carries `"exclude": []`, and that line is the whole point. `extends` inherits `include` and
`exclude` from the base config unless they are redefined, so a test config that only redefines
`include` still excludes every test file and reports success having checked nothing. Written the
obvious way first, it passed while silently seeing zero test files. Verified by putting a
non-existent opcode into a test and watching the check fail.

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
MAX_TOKEN="$(cat /path/to/token)" node dist/bin/max.js session start --json
node dist/bin/max.js chats list --json --limit 5
```

The token goes in a file and into the environment — never on a command line, where `ps` and shell
history can see it.

⚠ **Those directory variables also move the keyring entry** — `cli-core` makes the service
`max-cli:<config dir>` when any of them is set, so a session stored with them is invisible to a
command run without them, and the other way round. Export them for every command of the probe or
for none ([`ARCHITECTURE.md`](ARCHITECTURE.md) §14).

**The check no assertion replaces**: record a real run and read the directory.

```sh
node dist/bin/max.js chats list --limit 3 --record
node dist/bin/max.js runs list
cat "$(node dist/bin/max.js runs path <id>)/events.jsonl"
```

Done on 2026-09-20 against the owner's account: three requests, and the file carried opcodes,
`seq`, byte counts, durations and list lengths — no chat title, no name, no message, no token.

**Settings and the profile are checked without a network.** `src/config.test.ts` writes a
throwaway `config.json` into a temporary directory and asserts the order a setting is decided in,
that a missing file is not an error, and that a misspelled field is refused **by name** — the one
failure the schema exists to prevent. `src/output.test.ts` drives the protocol note from where it
is raised to where it lands, which is what `--quiet` was silently failing to cover (`BUG-7`).

**`pnpm probe:contacts`** re-measures the login's delta markers and prints no content
([`ARCHITECTURE.md`](ARCHITECTURE.md) §7). It is a probe, not a test: it needs a real session.

## What to write

Prefer the test that pins a contract someone could plausibly break over the one that restates the
implementation. The ones worth having here are the mismatched pairs: reading history must not mark
anything read; a retried send must reuse its `cid`; a send with no answer must be
`outcome_unknown`, never failed and never sent; an ambiguous chat name must refuse rather than pick;
**a diagnostic must carry the ids and none of the content** — `src/client.test.ts` drives a run
with a chat title, two names and two message bodies in play and asserts that none of the five
appears anywhere in the events, while the `cid` does, so it cannot pass by recording nothing.

Both defects found so far were found this way — a device identity that changed on every call, and
two sends in the same millisecond sharing a `cid`. Neither would have been visible from the outside
until it cost something.
