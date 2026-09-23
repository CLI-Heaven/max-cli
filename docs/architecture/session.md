# Session and login sync

Detail for [`ARCHITECTURE.md`](../ARCHITECTURE.md) §7: how the token is kept, how a profile is bound
to one account, what the login fetches, and how chat members get names.

**Status 2026-09-22: built; each part measured on the real account on the date given.**

## The token is replaced when it has gone stale, and kept

**LOGIN answers with a `token`, and it is a *new* one when the presented token has aged.** Measured
2026-09-22 (`pnpm probe:token`, plus a second run on a scratch profile):

| logging in with | what came back |
|---|---|
| the token pasted in months earlier | a different one |
| that new token, immediately after | **the same one** |

Not a rotation per login: MAX replaces an aged token once, then returns the same one, so the keyring
is not written on every command. Before the field was declared, the client discarded it and a
profile ran forever on the token pasted months earlier (`MAX-11`).

⚠ **The old token keeps working** — it kept logging in while MAX offered replacements. So this is
hygiene, not a repair, and the write may fail quietly.

`MaxClient.connect` writes it to the keyring, only when the value differs (one write per stale
token, none after), under three rules:

- **After the account check, never before** — or a stranger's token could replace the owner's
  working one.
- **A keyring that refuses does not fail the command** (locked keyring, no session bus): the old
  token still works. The reason goes to stderr (`NEED-97`).
- **`session start` writes the pasted token only when the login left nothing better** — `connect`
  has usually just stored a fresher one.

⚠ **It is a credential and nothing prints it** — not in a diagnostic, fixture, length or prefix. The
only comparison is against the token sent; the only output is whether a write failed.

## The login happens first, and the profile is bound to an account

⚠ **A token reaches the keyring only after MAX accepts it** (`src/session/adopt.ts`). Writing first
let a typo, an expired token or a closed browser tab replace a *working* credential — unrecoverably:
`Credentials.write` overwrites, and a keyring entry cannot be read back. The same shape destroyed two
working keys in `brazecli` on 2026-09-14 (noted in `cli-core`'s `credentials.ts`).

Restoring the old token after a failed login is worse: a kill between write and restore breaks the
profile. So `MaxClient.connect` tries a candidate token and stores nothing; `adoptToken` writes once
it is worth writing. It sits beside `handshake.ts`, not in the command, because `forCommand` builds
its own store and socket and code inside a command action cannot be driven by a test.

⚠ **A profile remembers its account and refuses another.** `viewerId` is saved from the first login;
every later `connect` compares it with LOGIN's answer. A mismatch is an `authentication_error` naming
`max <profile> session end` — the deliberate way to switch (`forget()` clears the id with the token).
Otherwise `max <profile> messages send` could speak as somebody else.

- The refusal comes **before** the state is written: no login count (`RISK-2`), no `lastLoginAt`.
- Nothing to compare (a profile older than the check, a login with no profile) → accepted, and the
  stored id is kept.

Measured 2026-09-21, all three halves: **MAX returns the same account id on every login** (three in
a row against an id stored by older code, no refusal); a refused login left an existing keyring entry
byte-for-byte unchanged, in the OS keyring, not the in-memory one tests use; a crossed id was refused
with `stdout` empty and the login count still zero. The last two ran on a throwaway profile.

## The login asks for a delta

`LOGIN` carries `chatsSync`, `contactsSync`, `presenceSync`, `draftsSync`. They are **timestamps, not
flags**: MAX returns only what changed since then, and the response's `time` is the next marker.

Measured 2026-09-20 (`pnpm probe:contacts`):

| `contactsSync` / `chatsSync` | came back |
|---|---|
| `0` | 6 contacts, 25 chats — everything |
| the `time` the previous login answered with | 0 contacts, 0 chats |
| a week before that | 1 contact, 11 chats — a subset |

Row three rules out "any non-zero value suppresses the collection". The profile arrives either way.
All four fields take the same marker: a week-old one in `presenceSync` and `draftsSync` too changed
nothing and the profile still arrived (same day, `NEED-103`).

- **`src/session/handshake.ts` sends the stored marker in all four**, so only a profile's first login
  fetches everything. The marker is one row (`sync_marker`) in the cache database, not the state
  file, so `max cache clear` forgets marker and rows together.
- ⚠ **Marker and rows are written in one transaction** (`mergeDelta`, `src/cache/store.ts`). A marker
  saved over rows that failed makes the next login ask for changes since data nobody has; those
  people stay missing, silently. It has its own test.
- ⚠ **A delta is mostly empty, and that is correct**: after the first login, absent means unchanged.
  The store merges and never deletes on absence — except chat membership, which MAX restates in full
  with the chat. Rendering the response instead of the store shows a full list once, then empty.
- ⚠ **The login's `contacts` is a subset, not an address book**: 6 against 25 chats here, six of
  seventeen dialog partners on 2026-09-19. A delta keeps it current; it does not widen it.
- `max contacts sync` forgets the marker so the next login takes everything. It repairs a drifted
  store or one emptied by a schema rebuild, and is the only way to prune somebody MAX stopped
  returning. It is not how contacts normally arrive.

## A chat carries its members, and we ask who they are

`chat.participants` is an object **keyed by contact id**. `#partnerOf` returns `undefined` unless
exactly one id is not ours; it still names a *dialog*, but no longer decides whom we look up.
`#peopleFor` takes every participant of every non-channel chat (before 2026-09-20 a group of three
named nobody).

Measured 2026-09-20: the login's chats held **23 distinct people**; its `contacts` named **6**.

| kind | chats | participants listed | claimed |
|---|---|---|---|
| `DIALOG` | 17 | 33 | 33 |
| `CHAT` | 4 | 22 | 22 |
| `CHANNEL` | 4 | 4 | 178 011 |

**Groups list all members; channels do not** (`participantsCount` is the subscriber count). So all
group members are named by one `CONTACT_INFO` over ids in hand, batched at 100, and **channels are
skipped**: four of 178 011 subscribers would be a wrong answer, not a partial one.

The batch of 100 is a choice, not a measurement. The comparable bound: `chatsCount` accepts 100 and
rejects 200 as out of range (`PROTO-3`). Someone in forty groups will find the real limit, as a
refusal that names itself.
