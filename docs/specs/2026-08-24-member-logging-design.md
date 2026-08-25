# Member Logging, Offline Queue & Live Sync — Design Spec

> **Status:** DRAFT
> **Author:** Pete (with Claude)
> **Date:** 2026-08-24
> **Follows:** [Groups & Sessions](2026-08-24-groups-and-sessions-design.md) (v0.2)
> **Also follows:** [Super Admin UI](2026-08-21-super-admin-ui-design.md) (v0.1, shipped)
> **Product context:** [Mango Tracker Product Vision](2026-08-19-mango-tracker-product-vision.md)

## Purpose

v0.1 shipped platform identity. v0.2 ships the containers — groups, sessions, and the emoji
catalog — but every one of its surfaces sits behind `/admin`, and it says so plainly: a friend
invited to a group accepts the invitation, signs in, and sees nothing.

This slice is the other half. It gives members a surface of their own, lets them log the items a
session tracks with a single tap, and makes those taps survive a beach with no signal and converge
across everyone's phones. It is the first thing in this product a person who is not an administrator
will ever use.

**This spec assumes v0.2 is shipped.** It builds directly on `cohorts`, `cycles`,
`cycle_participants`, `item_types`, `cycle_item_types`, and `requireCohortRole`. The `milestone3`
branch is stacked on `milestone-2` for exactly this reason.

## Scope

### Must Have

- **A member surface outside `/admin`** — the first authenticated area in the app gated on session
  participation rather than platform role.
- **One-tap logging.** A tap on an item logs +1, immediately, with no confirmation step and no
  attribution prompt.
- **An append-only ledger** in `packages/core` — immutable rows, per-session monotonic sequence,
  deletions expressed as tombstone rows rather than mutations.
- **Undo and delete of your own logs** while a session is open, via an undo affordance on the tap
  and a "your logs" list for older corrections.
- **Offline-first logging.** Taps queue in IndexedDB and flush when connectivity returns. The app is
  an installable PWA.
- **Sync-cursor propagation.** Each client holds a per-session aggregate plus a cursor, pulls only
  the delta beyond that cursor, and folds it in. SSE push on wifi, interval polling otherwise.
- **A live leaderboard** — per-person and group totals per item type, correct offline as of last
  sync, updating as deltas arrive.
- **A server-side current-session pointer** driving the default logging context, with a switcher.
- **Admin logging on behalf of a member, and untagged "for the group" logging**, on the v0.2 admin
  session page.

### Out of Scope (this slice)

- **Session-lifecycle notifications** (open / closing soon / closed) and web push — v0.4.
- **The recap moment and the post-close audit view** of admin edits — v0.5. The ledger this slice
  builds is what makes that view possible without a second history table, but the view itself is
  not built here.
- **Overtake and milestone notifications**, achievement badges, confetti — already Should/Could Have
  in the vision.
- **Mango/Mexico/beach theming.** Functional Tailwind, same as v0.1 and v0.2 — see the decision
  below.
- **E2E/browser testing** — still deferred, with a named consequence recorded under Testing.
- Group deletion, session templates, per-group catalogs.

### Decisions that resolve open questions

| Open question | Source | Resolution |
|---|---|---|
| Should members see the full group roster? | Vision (deferred to design), v0.2 ("**still open** — member-facing") | **Yes.** A leaderboard *is* a roster. Session participants see each other's names and counts; group members see the group roster. Semi-private membership is incompatible with the product's core feature. |
| How does the individual/shared choice fit into "one tap"? | Vision Core Experience | **It doesn't — members never make it.** See "Attribution" below. |
| Can a member log into a session past `ends_at` that nobody closed? | Inherited from v0.2's derived status | **Yes.** v0.2 decided close is explicit and "member edits stay open until an admin closes." The overdue banner prompts; it never blocks. |
| Does the current-session toggle live client-side or server-side? | Vision Must Have | **Server-side**, so it follows a user across devices. Validated on read — see "The current-session pointer." |

### Attribution: a correction to the product vision

The vision says each log "declares individual vs. shared attribution: individual = +1 to that person
and the group; shared = +0 to the individual, +1 to the group only," and puts that choice in the
member's tap path.

**That choice is removed from the member's path entirely.** In a collaborative group every member's
log automatically counts toward the group — that is what "individual = +1 person, +1 group" already
meant. Untagged logging (the +0/+1 case) is the tray case: someone hands out mangoes to everybody and
nobody in particular gets the credit. That is an *administrative* act, and it lives on the admin
surface.

So the arithmetic the vision specified is preserved exactly, and it falls out of two identity columns
instead of an attribution enum:

| | `actor_user_id` (who recorded it) | `subject_user_id` (who it counts for) |
|---|---|---|
| Member logs their own | self | self |
| Admin logs on behalf of Dave | admin | Dave |
| Admin logs untagged for the group | admin | `null` |

Personal total = entries where `subject_user_id` is you. Group total = **all** entries, tagged or
not. Members never encounter the concept; the word "shared" does not appear on a member screen.

The vision doc's Core Experience section is corrected in the same commit as this spec, the way v0.2
corrected its auto-close line.

### Theming stays deferred — with one constraint

v0.1 and v0.2 both shipped functional Tailwind because both were admin-only. This slice is not, and
the vision calls the visual identity "the primary differentiator of v1." Theming is nonetheless
**deferred to its own slice**, because this one already carries three hard subsystems (ledger,
offline queue, sync) and design iteration is the part that resists estimation.

The cost is real: v0.4 re-skins every screen written here. To keep that a re-skin rather than a
rewrite, member UI is built with **semantic component boundaries** — `TapTarget`, `Leaderboard`,
`SyncBadge`, `EntryList` — rather than styling smeared inline across page components. That is the
whole constraint. No design system, no token layer, just seams.

## Architecture

### `packages/core` — vocabulary

Extending v0.2's mapping table. Core still says nothing an unrelated app couldn't say:

| Core (generic) | `packages/web` display |
|---|---|
| `Cohort` | Group |
| `Cycle` | Session |
| `ItemType` | item type / emoji |
| **`LedgerEntry`** | **a log** |
| **`subjectUserId = null`** | **untagged / "for the group"** |

**Why `ledger` and not `events` or `logs`.** `event` is already overloaded in a browser codebase —
DOM events, SSE events, `EventSource` — and `log` collides with logging-as-in-console. `ledger` is
unambiguous, generic, and carries no domain noun, so it clears the root `CLAUDE.md` boundary.

New module `src/ledger/`, following the shipped `roles/` and v0.2 `cycles/` layout — `types.ts`, a
pure fold in its own file, a store exporting `createPostgresLedgerStore(pool)` against an interface,
no module-level pool, zero Next.js imports.

| File | Responsibility |
|---|---|
| `src/ledger/types.ts` | `LedgerEntry`, `LedgerEntryKind`, `AppendOp`, `Aggregate`, `SubjectKey` |
| `src/ledger/fold.ts` | `foldEntries(aggregate, entries) => Aggregate` — pure, no I/O |
| `src/ledger/ledgerStore.ts` | `LedgerStore` interface + `createPostgresLedgerStore` |
| `src/ledger/index.ts` | Re-exports |
| `src/cycles/currentCycleStore.ts` | `CurrentCycleStore` — the per-user session pointer (added to v0.2's module) |
| `src/db/schema.sql` | Modified — appends `ledger_entries`, `user_current_cycle`, and `cycles.last_seq` |

### A void is a row, not an update

Deleting a log appends a **second row** with `kind = 'void'` referencing the first. The original is
never mutated and never deleted.

This is not bookkeeping fussiness. Three things depend on it:

1. **Deletions propagate.** A void takes a sequence like anything else, so a client sitting at cursor
   N learns about it through the same delta stream as an addition. If deletions were row mutations,
   that client would never find out and its aggregate would drift permanently with no path to
   self-correct.
2. **v0.5's audit view needs no second table.** "Every post-close admin edit is recorded and visible"
   is a vision Must Have. The ledger already is that record.
3. **Offline stays conflict-free.** Two clients voiding the same entry produce two void rows; the
   fold is idempotent per entry id, so the count lands at the same place either way.

The fold is `log → +1`, `void → −1`.

**A void row copies `item_type_key` and `subject_user_id` from its target.** Denormalized on purpose:
the client fold is then a pure function over the delta stream, needing no join and no lookup into
rows the client may never have received.

### Every appended row takes the same sequence

Member taps, tombstones, admin-on-behalf writes, and admin untagged writes all draw from the one
per-cycle counter. No exceptions. A write path that bypassed the counter would be invisible to every
synced client forever.

### Schema

Appended to the single `schema.sql` that `runMigrations` replays on every boot. Purely additive
except for one column added to v0.2's `cycles`:

```sql
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS last_seq bigint NOT NULL DEFAULT 0;

ledger_entries    (id uuid pk default gen_random_uuid(),
                   cycle_id uuid not null references cycles(id) on delete cascade,
                   seq bigint not null,
                   kind text not null check (kind in ('log','void')),
                   item_type_key text not null references item_types(key),
                   subject_user_id text,              -- null = untagged, group-only
                   actor_user_id text not null,
                   voids_entry_id uuid references ledger_entries(id),
                   client_entry_id uuid not null,
                   occurred_at timestamptz not null,
                   created_at timestamptz not null default now(),
                   check (kind = 'log' or voids_entry_id is not null))
                  + unique (cycle_id, seq)
                  + unique (cycle_id, client_entry_id)
                  + index on (cycle_id, seq)

user_current_cycle (clerk_user_id text primary key,
                    cycle_id uuid not null references cycles(id) on delete cascade,
                    updated_at timestamptz not null default now())
```

- **`unique (cycle_id, client_entry_id)`** is the idempotency key. The insert is
  `ON CONFLICT DO NOTHING`, so replaying an outbox after a flaky reconnect cannot double-count, and
  the server reports which ids it already held.
- **`ALTER TABLE … ADD COLUMN IF NOT EXISTS`** keeps intact the idempotent-replay model v0.1
  established and v0.2 preserved.
- `on delete cascade` on `user_current_cycle` handles a deleted session; the read-time validation
  below handles everything else.

### Sequence assignment

Inside the same transaction as the insert:

```sql
UPDATE cycles SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq;
```

The `UPDATE` takes a row lock on the cycle held until commit, so a second appender blocks until the
first commits. **Commit order therefore matches sequence order** — which is the property that
`?after=cursor` actually depends on, and the reason the counter lives on the cycle row.

A global `bigserial` does **not** give this. Transaction A takes seq 5, B takes 6, B commits first; a
client polling at cursor 4 sees 6, advances its cursor past 5, and loses entry 5 permanently with no
way to notice. That is precisely the silent data loss the vision's success criteria rule out.

Serializing writes per cycle costs nothing at this scale — a session is on the order of ten people
tapping. A batch flush of N outbox ops takes N sequences in one transaction under one lock.

### The current-session pointer

Stored server-side so it follows a user between devices, but **validated on every read** rather than
trusted. The pointer resolves to a session only if all of these hold:

1. the row exists (the `on delete cascade` has not removed it), and
2. the user is still in `cycle_participants` for it — v0.2's group-removal flow deletes participant
   rows for open sessions, so this is a live case, not a theoretical one, and
3. the cycle is not closed.

If any fails, the pointer is ignored and the member lands on the session chooser. A stale pointer is
never an error state and never surfaces as one.

### `packages/web` — the third gate

v0.1 gave `requireRole` (platform). v0.2 gives `requireCohortRole` (platform **and** group). Both
gate `/admin`. This slice adds the first gate that is not an admin gate:

```ts
requireCycleParticipant(cycleId: string): Promise<CycleGuardResult>
```

It checks `cycle_participants` **only** — no platform role component at all. This is what finally
lets a plain platform `member` do something in this application, and it closes the gap v0.2 named
explicitly. Platform `owner` passes unconditionally, matching the superuser escape hatch both prior
slices established.

Like its two predecessors, **it is called inside each route handler**, never relied on from a layout:
route handlers don't run layouts.

### Route structure

A `(member)` route group whose layout gates on "signed in" only — membership is a per-resource
question, checked at the resource. It mirrors `app/admin/layout.tsx` in shape so there is one obvious
place the member gate lives, rather than one invented per page.

`/` becomes the member home for signed-in users and keeps the existing splash, plus a sign-in button,
for signed-out ones. The product is invite-only so there is nothing to market, but an abrupt redirect
is a worse door than a page.

`proxy.ts` still does no gating; its matcher already covers `/` and `/api/*`, so it needs no change.

## API Surface (Next.js Route Handlers, server-only, `packages/web`)

URLs and copy say Session; only `core` says Cycle. Member routes live under `/api/*` — a namespace
distinct from `/admin/api/*`, because everything under `/admin/api/*` is platform-admin territory by
v0.2's rule and that rule stays uniform.

### Member namespace

| Route | Auth | Notes |
|---|---|---|
| `GET /api/sessions` | signed in | Your sessions, split live / scheduled / recent |
| `PUT /api/current-session` | participant of target | `{ sessionId }`, or `{ sessionId: null }` to clear |
| `GET /api/sessions/:id/snapshot` | participant | `{ cursor, counts, participants, itemTypes, session }` — the only read that is not a delta |
| `GET /api/sessions/:id/entries?after=<seq>` | participant | Paged delta; returns `nextCursor` and `hasMore` |
| `GET /api/sessions/:id/stream` | participant | SSE, `?after=<seq>`, emitting the same delta shape |
| `POST /api/sessions/:id/entries` | participant | Batch outbox flush |

### Admin namespace (extends v0.2's)

| Route | Auth | Notes |
|---|---|---|
| `POST /admin/api/groups/:g/sessions/:s/entries` | group admin \| `owner` | `{ itemTypeKey, subjectUserId \| null }` — on-behalf and untagged |
| `POST /admin/api/groups/:g/sessions/:s/entries/:entryId/void` | group admin \| `owner` | Permitted after close; members are not |

### The batch flush

```jsonc
{ "ops": [
  { "clientEntryId": "<uuid>", "kind": "log",
    "itemTypeKey": "mango", "occurredAt": "2026-08-24T21:03:11.412Z" },
  { "clientEntryId": "<uuid>", "kind": "void",
    "voidsClientEntryId": "<uuid>", "occurredAt": "2026-08-24T21:04:02.008Z" }
] }
```

**A void references the target's *client* id, not its server id.** Offline you can void an entry
whose server id you have never seen; the server resolves the target through
`unique (cycle_id, client_entry_id)`. Ops are processed in array order so a batch containing both an
entry and its void behaves correctly.

Response:

```jsonc
{ "cursor": 417,
  "accepted":   ["<uuid>"],
  "duplicates": ["<uuid>"],
  "rejected":   [{ "clientEntryId": "<uuid>", "reason": "session_closed" }] }
```

`duplicates` is a normal outcome of a retried flush, not an error — the client treats those ids as
accepted and clears them from the outbox.

## Client Architecture

Three layers under `packages/web/src/lib/sync/`, deliberately separated so the piece that must be
correct is the piece with no I/O in it.

| File | Responsibility |
|---|---|
| `lib/sync/fold.ts` | Re-export of core's pure `foldEntries` plus display selectors |
| `lib/sync/store.ts` | IndexedDB via `idb` — `cursor`, `counts`, `outbox`, `myEntries` per session |
| `lib/sync/client.ts` | Orchestration: cold-open snapshot, delta pull, SSE-or-poll, outbox flush |

### What the client stores

```ts
type SubjectKey = string;                 // a Clerk user id, or "__untagged__"
type Aggregate = {
  cursor: number;
  counts: Record<SubjectKey, Record<ItemTypeKey, number>>;
};
```

Keyed `(subject, itemType)` because the leaderboard needs per-person **per-item** counts, and the
group total per item is the sum across every subject key including `__untagged__`.

`myEntries` holds **only your own** entries, because the aggregate is counts-only and the "your logs"
list needs actual rows. That is bounded by your own thumb — tens of rows. Everyone else's entries are
folded into `counts` and discarded, which is what keeps storage flat no matter how long a session
runs.

**Displayed totals are `foldEntries(counts, outbox)`** — computed at render, not written into the
aggregate. Your pending taps show instantly and can never be double-counted: when the server's own
copy of an entry arrives in the delta stream, the matching outbox op is dropped in the same step.

### Cold open

If there is no local aggregate for a session, `GET /snapshot`. If there is, `GET /entries?after=cursor`.
The snapshot is the only non-delta read path, which is why it is a named endpoint rather than
"replay from seq 0" — replaying from zero would grow linearly with session length forever.

### Undo is two cases

| Target state | Undo does |
|---|---|
| `pending` — still in the outbox | Remove it from the outbox. **No tombstone ever reaches the server.** |
| `synced` — already accepted | Enqueue a `void` op. It is an append, it takes a sequence, and it propagates to every other client. |

An entry therefore has three renderable states — `pending`, `synced`, and `voiding` (struck through
until its void is accepted) — and the "your logs" list renders all three. This is the part an
implementer gets wrong if it is left as one bullet, so it is spelled out here and appears in the
acceptance criteria.

### Sync and flush triggers

Both sets are the same: the `online` event, `visibilitychange` → visible, and a periodic tick while
the page is open.

Push uses SSE when the Network Information API reports wifi. **"Unknown" counts as cellular** and
polls on a longer cadence — the vision's iOS Safari caveat, where mis-detection must cost liveness
and never correctness. It cannot cost correctness here because the cursor/fold path is identical
either way; SSE only changes how soon a delta arrives.

**No dependency on the Background Sync API.** It is Chromium-only, and the target device is a
friend's iPhone at a beach. Flush is driven by the page on the triggers above; Background Sync is
progressive enhancement where it exists.

### PWA

- `manifest.webmanifest` plus icons; installable, mobile-first, usable one-handed.
- A **hand-written** `public/sw.js` doing app-shell precache and navigation fallback — not
  `next-pwa`. The repo is on Next 16 and TypeScript 7, and `npm run lint -w web` is already broken
  because typescript-eslint does not support TS 7 (issue #21). Adding a build-time plugin carrying
  its own Next version assumptions is how a second issue like that gets created.
- The service worker never replays POSTs. The outbox is IndexedDB and the page owns it.

New runtime dependency: `idb`. That is the only one.

## UI Pages & Flows

Functional Tailwind, semantic component seams, following v0.1's and v0.2's pattern — pages are server
components reading stores directly; client components are colocated; route handlers serve client-side
mutations.

- **`/`** — signed out: the existing splash plus a sign-in button. Signed in: resolve the
  current-session pointer, render the session screen, or the chooser when the pointer is absent or
  invalid.
- **`/sessions`** — your sessions, split live / scheduled / recent.
- **`/sessions/[sessionId]`** — the live screen. Header with the session switcher; N tap targets
  drawn from `cycle_item_types` ordered by `position`; your count and the group count per item; the
  leaderboard; a sync badge showing queued-vs-synced; the overdue banner when v0.2's `isOverdue` is
  true; a menu to "your logs". A tap fires immediately with an undo toast.
- **`/sessions/[sessionId]/logs`** — your logs for the session, rendering all three entry states,
  with delete.
- **`/groups/[groupId]`** — the member's read-only view of the group: roster and session list.
- **v0.2's admin session detail page** gains an on-behalf / untagged logging control.

**Tap target layout is mechanical by N**, since theming is deferred: one item renders as a single
large target, two to four as a grid, five or more as a scrollable grid of smaller tiles. Getting this
to feel good is v0.4's job; getting it usable one-handed is this slice's.

## Error Handling

| Case | Behavior |
|---|---|
| Tap while offline | Registers locally with a pending indicator; no error surfaced. Flushes on reconnect |
| Flush returns `duplicates` | Treated as accepted; outbox entries cleared. Never surfaced to the user |
| Flush partially rejected | Rejected ops are removed from the outbox and reported once, naming the reason; accepted ones are not retried |
| Member writes to a closed session | `403` with a message that only a session admin can amend a closed session; the tap targets render disabled once the client knows the session is closed |
| Admin writes to a closed session | Allowed — vision Must Have. Recorded in the ledger like any other entry |
| Non-participant hits a member session route | `403`, with no information about whether the session exists |
| Session id valid but the caller was removed from the group | `403` — the same shape, so removal is not distinguishable from never having been a member |
| Current-session pointer is stale (closed, removed, deleted) | Silently ignored; the chooser renders. Never an error state |
| Void targets an entry that is not yours | `403`; members may only void their own |
| Void targets an unknown `clientEntryId` | That op comes back in `rejected` with reason `unknown_target`; the rest of the batch still applies |
| SSE connection drops | Reconnects automatically; on failure the client falls back to polling. Correctness is unaffected — the cursor is authoritative |
| IndexedDB unavailable (private mode, quota) | The app degrades to online-only logging with a visible banner, rather than failing taps silently |

## Testing

Same convention as both predecessors — real Postgres, fake only the Clerk boundary.

### `packages/core`

- **`foldEntries` unit tests** — the pure piece, so the cheap tests go where the risk is: void
  ordering (a void arriving before its target), out-of-order deltas, an already-applied delta
  reapplied, untagged entries counting toward the group but no individual, and the empty aggregate.
- **`LedgerStore` against a real local test Postgres** — append, batch append, idempotent re-append
  of the same `client_entry_id`, void insertion copying its target's item and subject, delta reads by
  cursor, and snapshot computation.
- **A concurrency test.** N simultaneous appends to one cycle, asserting the sequence is gapless and
  that commit order matches sequence order. This single test is what protects the entire cursor
  model; without it, the row-lock argument above is an assertion rather than a fact.
- `CurrentCycleStore` — set, read, and each of the three invalidation cases.

### `packages/web`

Route handler tests against a test Postgres with the Clerk client faked:

- Participant guard: non-participant `403`, participant passes, platform `owner` passes as superuser,
  unauthenticated `401`.
- Batch idempotency — the same `clientEntryId` posted twice yields one row and one `duplicates` entry.
- Voiding another member's entry is rejected; voiding your own succeeds.
- A member write after close is rejected; an admin write after close is accepted.
- Untagged write stores `subject_user_id = null` and counts toward the group total only.
- On-behalf write stores a distinct actor and subject.
- Delta endpoint paging and `nextCursor` correctness.
- Current-session `PUT` rejects a session the caller does not participate in.

### Client

`foldEntries` is pure, so plain unit tests. The store and outbox are tested against
`fake-indexeddb` — enqueue, flush, partial rejection, and the two undo cases.

### E2E: still deferred, and what that costs

No browser tests in this slice, consistent with v0.1 and v0.2.

**This is the one place in this spec where the convention and the success criteria disagree**, and it
is recorded rather than smoothed over. "0% silent data loss for offline-queued logs" is a vision
success criterion, and the offline queue → reconnect → converge path is exactly what unit and
integration tests cannot prove end to end. Deferring E2E means that criterion rests on manual
verification. So the manual verification is written down rather than left to memory:

1. Open a live session in two browser profiles signed in as two different participants.
2. In profile A, throttle to offline via devtools. Log five taps across at least two item types.
3. Confirm all five render with a pending indicator, and A's own totals include them.
4. Restore connectivity. Confirm all five flip to synced, and that the ledger holds exactly five
   rows — not four, not ten.
5. Confirm profile B converges to the same totals without a reload.
6. In A, undo one synced entry. Confirm B's totals drop by one.
7. Reload A cold with the network offline. Confirm the leaderboard still renders from the local
   aggregate.

This checklist is part of the slice's definition of done, and the first candidate for automation when
E2E does arrive.

## Tracking

Milestone **[v0.3 — Member Logging](https://github.com/pete-the-pete/mangoes/milestone/3)** (#3), created with
`gh api repos/pete-the-pete/mangoes/milestones` (there is no `gh milestone create`).

**Issues [#55–#70](https://github.com/pete-the-pete/mangoes/milestone/3) — 16 tasks**, all on
[Project #6](https://github.com/users/pete-the-pete/projects/6). `#55` (ledger store) and `#57`
(current-session pointer + participant queries) have no blockers and start in **Ready**; the rest
start in **Backlog**. Dependencies are recorded as `Blocked by #N` plain text in issue bodies, per
the [milestone-execution design doc](../plans/2026-08-22-milestone-execution-workflow.md).

**These issues were created from this spec, not from an implementation plan** — inverting the order
v0.1 and v0.2 used, at the product owner's direction. Acceptance criteria therefore live in the
issue bodies and are authoritative there. If a plan doc follows, it must **reference issue numbers
rather than restate their criteria**; writing acceptance criteria in two places is how they drift,
which is the reason v0.2 sequenced it the other way.

v0.2 shipped in full (milestone #2, 20/20 closed, merged through PRs #50–#53), so nothing in this
milestone is blocked on it. Three gaps in what v0.2 actually shipped are folded into the tasks above:

- `CycleStore` is cohort-scoped only — there is no `listCyclesForParticipant` or `isCycleParticipant`,
  and both are required before any member route can be written (#57).
- `cycle_participants` has no index on `clerk_user_id`, which both new queries filter on (#57).
- `cycles` has no `last_seq` column (#55).

No E-tickets — everything in this slice is agent-executable.

## Handoff

1. This spec is reviewed and committed, along with the product-vision correction to the attribution
   model described above.
2. ~~Plan doc, then issues.~~ **Done differently:** milestone #3, issues #55–#70, and board items
   were created directly from this spec. A plan doc is optional now and, if written, references
   issue numbers rather than restating criteria.
3. Implementation proceeds one branch/PR per issue, each with `Closes #N`. v0.2 has merged, so
   `#55` and `#57` are unblocked today.

### Risks carried into planning

| Risk | Mitigation |
|---|---|
| Three hard subsystems in one slice — ledger, offline queue, sync. The vision already names offline-first as the one genuinely Type-1 technical bet | Plan the ledger and its concurrency test first and merge it before any client work starts; the sync layer is only as trustworthy as the sequence guarantee underneath it |
| v0.4 re-skins every screen written here | Semantic component seams, specified above, are the whole mitigation. Keep pages thin |
| No E2E on the one path whose failure mode is silent | The written manual checklist above, run as part of definition of done |
| ~~v0.2 in flight~~ — resolved: v0.2 merged (PRs #50–#53) and `milestone3` is rebased onto `main` | n/a |
