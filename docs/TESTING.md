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

**An opcode with no scripted answer fails the test that sent it**, naming the opcode. The mock
records it in `max.unexpected`, and `src/testing/unscripted.ts` — a second `setupFiles` entry —
checks every mock the test built once it ends. Before that the mock only stayed silent, the client
timed out, and the test failed, if at all, on a symptom three steps downstream.

A test that means a request to go unanswered says so by scripting silence, `() => undefined` —
`src/client.test.ts` does it for a send whose answer is lost.

## No test touches the owner's own files

⚠ **`pnpm test` runs with config, state and cache pointed at a temporary directory**, set by
`src/testing/sandbox.ts` and wired in as a vitest `setupFiles`, so it applies to every test file
rather than to the one that remembered.

This is not precaution. On 2026-09-22 a new test drove a real command for the first time — until
then the suite only checked argument parsing — and the command opened the **real** cache. Opening
it migrates it, and that day's change was a schema bump, so the migration rebuilt it and threw the
owner's cached history away. Nothing failed; it was noticed from a file timestamp.

The three variables also scope the keyring entry, which is the trap documented in
[`ARCHITECTURE.md`](ARCHITECTURE.md) §14 and here is exactly the isolation wanted.

**Check it still holds** rather than trusting it — comment out `setupFiles` and watch the real
cache file's timestamp move:

```sh
stat -c %Y ~/.cache/max-cli/default.db && pnpm vitest run src/program.test.ts && stat -c %Y ~/.cache/max-cli/default.db
```

## No test touches a real keychain

The keyring is one injected function from `cli-core`, replaced by `memoryKeyring()` in every test.
Setting a config directory would be necessary but not sufficient — one test that forgets it writes
to the developer's actual keychain. The seam makes it impossible rather than discouraged.

## The live checks, and why they are not tests

There is no automated suite against the real MAX, and there should not be: it needs a real account,
a live token, and it writes messages. What exists instead is a set of probes run by hand, whose
results are recorded in [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`architecture/`](architecture/) with the
date they were measured — deduplication by `cid`, 18-digit message ids, `chatsCount` bounds, contact coverage.

When you re-run one, update the sentence it supports. A measurement nobody can replay is a rumour,
and a measurement that has quietly stopped being true is worse.

**A manual run from a checkout goes through `bin/max`**, never `node dist/bin/max.js` directly:

```sh
pnpm build
bin/max session start            # once per worktree; asks for the token, echoes nothing
bin/max chats list --json --limit 5
```

It runs the build with config, state and cache in `.max/` inside the worktree (gitignored). A
build with a newer cache schema migrates whatever cache it opens and drops the read history, so a
branch must never open the owner's real one.

⚠ **Each worktree therefore has its own session.** The directory variables also move the keyring
entry — `cli-core` makes the service `max-cli:<config dir>` when any of them is set
([`ARCHITECTURE.md`](ARCHITECTURE.md) §14) — so a login in one worktree, or in the installed `max`,
is invisible to another, and every command warns about it on stderr. The token is typed at the
prompt; never on a command line or in a file.

**The check no assertion replaces**: record a real run and read the directory.

```sh
bin/max chats list --limit 3 --record
bin/max runs list
cat "$(bin/max runs path <id>)/events.jsonl"
```

Done on 2026-09-20 against the owner's account: three requests, and the file carried opcodes,
`seq`, byte counts, durations and list lengths — no chat title, no name, no message, no token.

**Settings and the profile are checked without a network.** `src/config.test.ts` writes a
throwaway `config.json` into a temporary directory and asserts the order a setting is decided in,
that a missing file is not an error, and that a misspelled field is refused **by name** — the one
failure the schema exists to prevent. `src/output.test.ts` drives the protocol note from where it
is raised to where it lands, which is what `--quiet` was silently failing to cover (`BUG-7`).

**`pnpm probe:token`** answers whether the login returns a rotated token. It prints the login
answer's **field names**, then three booleans about `token` — is it a string, is it empty, is it
the one we sent — and never the value, not a prefix and not a length. It writes nothing: not the
keyring, not the state file.

**`pnpm probe:contacts`** re-measures the login's delta markers and prints no content
([`ARCHITECTURE.md`](ARCHITECTURE.md) §7). It is a probe, not a test: it needs a real session.

### The delta sync has one failure no offline test can catch

Run a listing **twice** against the real account:

```sh
bin/max chats list --limit 3 --json
bin/max chats list --limit 3 --json   # the second run receives a near-empty delta
```

The second login answers with only what changed, which after a moment is nothing. Anything that
renders the response instead of the store shows a full list once and an empty one every time
after — and it shows it here and nowhere else, because every fixture starts from an empty store
and only ever sees a first login. `pnpm verify:live` now runs the listing twice for this reason.

Then open the database and check `chat_members` against a group you are in: the count should match
what the app shows, and those people should be in `people` **without** appearing in
`contacts list`. That is the ruling of [`ARCHITECTURE.md`](ARCHITECTURE.md) §15 made visible, and
no fixture proves it against a real account. Check by eye, too, that the first contacts really are
the people most recently talked to, and that `max contacts sync` names nobody in its summary.

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
