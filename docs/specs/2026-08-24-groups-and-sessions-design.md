# Groups & Sessions (Admin) — Design Spec

> **Status:** DRAFT
> **Author:** Pete (with Claude)
> **Date:** 2026-08-24
> **Follows:** [Super Admin UI](2026-08-21-super-admin-ui-design.md) (v0.1, shipped)
> **Product context:** [Mango Tracker Product Vision](2026-08-19-mango-tracker-product-vision.md)

## Purpose

v0.1 shipped platform-level identity: who is on the instance, and what platform role they hold.
This slice adds the two containers everything else in the product hangs off — **groups** (a named set
of people) and **sessions** (a time-boxed counting window scoped to a group) — plus the emoji catalog
that says what a session tracks.

It is deliberately the *administrative* half. An admin can stand up a group, invite people to it, and
create a session that declares its time box and its trackable items. Nobody can log anything yet.
Logging, leaderboards, and every member-facing surface come next, and they are built on the tables
this slice creates.

## Scope

### Must Have

- A **group**: named, created by a platform Admin or Super Admin, with multiple members and
  **multiple group admins**.
- **Two-axis authorization**: the existing platform role (`owner`/`admin`/`member`) plus a per-group
  role (`admin`/`member`). Neither replaces the other.
- Group admins can **invite by email** — one flow that handles both an existing platform user and a
  brand-new one, without giving admins access to the platform user table.
- A **session**: scoped to one group, named, with a start and end time, an explicit close action, a
  participant list (defaults to the whole group), and one or more emoji item types.
- A **platform-wide emoji catalog** seeded with the Unicode food-and-drink set, maintained by the
  Super Admin (enable/disable and relabel), from which group admins pick per session.
- Admin UI for all of the above under `/admin`, matching v0.1's plain functional styling.

### Out of Scope (this slice)

- **Logging** — the append-only event model, one-tap logging, individual/shared attribution.
- **Reporting** — leaderboards, live totals, recap views, the audit view of post-close edits.
- **Member-facing surfaces** — every page added here is behind the existing `/admin` gate. This has a
  consequence worth naming rather than discovering: a friend invited to a group accepts the
  invitation, signs in, and sees nothing about that group. Their membership is real and their
  participant rows exist; there is simply no surface for them yet. That is the accepted shape of an
  admin-only slice — admins compose rosters ahead of the logging release — not an oversight. If the
  gap between the two slices stretches out, the stopgap is to hold off on group invites, not to bolt
  a member view onto this one.
- Offline sync, SSE/polling propagation, notifications, the global "current session" toggle.
- Group deletion (rename covers the typo case; deletion needs cascade semantics that only matter
  once logs exist), session templates, per-group catalogs, per-item icons beyond the emoji itself.
- Mango/Mexico/beach theming — functional Tailwind only, same as v0.1.
- E2E/browser testing — still deferred.

### Decisions that resolve open questions from the product vision

| Vision Open Question | Resolution |
|---|---|
| One admin per group, or many? | **Many.** `cohort_members.role` carries `admin`/`member`. |
| Auto-close at end time, or explicit close? | **Explicit close.** The time box is a soft deadline; `ends_at` passing does not change a session's state. |
| Should members see the full group roster? | **Still open** — member-facing, and this slice ships no member surfaces. |

The vision doc's Core Experience section says a session "auto-closes to individual edits" at the end
of its time box. That is superseded by the explicit-close decision above; the vision doc is corrected
in the same commit as this spec.

## Architecture

### `packages/core` — generic vocabulary

Root `CLAUDE.md` bans the word "group" in `core`, and "session" collides with auth-session semantics
in a Clerk/Next.js app. Core therefore uses:

| Core (generic) | `packages/web` display |
|---|---|
| `Cohort` | Group |
| `Cycle` | Session |
| `ItemType` | (item type / emoji) |

This is the same mapping discipline v0.1 established for `owner → "Super Admin"`: the generic value
is the only thing core knows, and every user-visible string is a web-layer concern.

Three new modules, each following the shipped `roles/` layout — `types.ts`, a `<x>Store.ts` exporting
`createPostgres<X>Store(pool)` against an interface, pure guards in their own file, no module-level
pool, zero Next.js imports:

- **`cohorts/`** — `Cohort`, `CohortMemberRecord`, `CohortRole = "admin" | "member"`. `CohortRole` is
  a distinct type from the platform `Role`; the two are never assignable to each other.
- **`cycles/`** — `Cycle`, `CycleParticipant`, and a derived `CycleStatus`.
- **`itemTypes/`** — a generic countable-type catalog: `{ key, emoji, label, enabled, position }`.

**The catalog's seed data lives in `packages/web`, not `core`.** A list of food emoji contains the
literal words "mango" and "taco", so shipping it in core would violate the architecture boundary.
Core owns the generic table and store; web owns the ~130-entry seed array.

#### Pure guard

```ts
type CohortMemberChange =
  | { type: "role"; role: CohortRole }
  | { type: "remove" };

function wouldRemoveLastCohortAdmin(
  members: Pick<CohortMemberRecord, "clerkUserId" | "role">[],
  targetUserId: string,
  change: CohortMemberChange,
): boolean;
```

Two variants, unlike `wouldRemoveLastOwner`, because platform users cannot be deleted but group
members can be removed — and both paths can strand a group with zero admins.

#### Derived status

`CycleStatus` is computed, and `closed_at` is the only durable fact:

- `closed_at != null` → `closed`
- else `now() < starts_at` → `scheduled`
- else → `live`

Because close is explicit, **a session past `ends_at` that nobody closed is still `live`.** The store
exposes that as a separate `isOverdue` boolean so the UI can prompt without the state changing on its
own. The logging slice inherits this: member edits stay open until an admin closes.

### Schema

Purely additive — appended to the single `schema.sql` that `runMigrations` replays on every boot.
Nothing touches `user_roles`, so the idempotent-replay model still holds. `gen_random_uuid()` is safe
on both local `postgres:16-alpine` and Neon.

```sql
cohorts            (id uuid pk default gen_random_uuid(), name text not null,
                    created_by text not null, created_at, updated_at)

cohort_members     (cohort_id uuid references cohorts(id) on delete cascade,
                    clerk_user_id text not null,
                    role text not null check (role in ('admin','member')),
                    created_at, primary key (cohort_id, clerk_user_id))
                   + index on (clerk_user_id)

cycles             (id uuid pk default gen_random_uuid(),
                    cohort_id uuid references cohorts(id) on delete cascade,
                    name text not null, starts_at timestamptz not null,
                    ends_at timestamptz not null,
                    closed_at timestamptz, closed_by text,
                    created_by text not null, created_at, updated_at,
                    check (ends_at > starts_at))
                   + index on (cohort_id, starts_at desc)

cycle_participants (cycle_id uuid references cycles(id) on delete cascade,
                    clerk_user_id text not null, created_at,
                    primary key (cycle_id, clerk_user_id))

item_types         (key text primary key, emoji text not null, label text not null,
                    enabled boolean not null default true, position int not null default 0,
                    created_at, updated_at)

cycle_item_types   (cycle_id uuid references cycles(id) on delete cascade,
                    item_type_key text references item_types(key),
                    position int not null default 0,
                    primary key (cycle_id, item_type_key))
```

**Disabling a catalog entry is picker-only.** `enabled = false` removes an entry from the picker for
new and edited sessions; existing `cycle_item_types` rows keep resolving and keep rendering. No
cascade, no orphan handling, no retroactive change to a session someone already created.

### `packages/web` — the second authorization axis

`requireRole()` is unchanged. Alongside it:

```ts
requireCohortRole(cohortId: string, allowed: CohortRole[]): Promise<CohortGuardResult>
```

It composes two checks in order:

1. **Platform gate** — the caller must hold platform `owner` or `admin`. Everything under
   `/admin/api/*` is platform-admin territory, and this keeps that uniform: a plain platform member
   who happens to be in a group gets `403` from these routes. Their member-facing view of the same
   group arrives with the logging slice, on its own surface.
2. **Group role** — the caller's `cohort_members.role` must be in `allowed`. Platform `owner` passes
   this step unconditionally, so the Super Admin can always intervene.

Like `requireRole`, **it is called inside each route handler**, never relied on from a layout: route
handlers don't run layouts, which is why `app/admin/layout.tsx` gates pages only.

#### Invariant: group admin implies platform admin

A user may hold `cohort_members.role = 'admin'` only if their platform role is `admin` or `owner`.
Promoting a plain member to group admin returns `400` telling the caller to have a Super Admin
promote them first.

The reason is structural: `app/admin/layout.tsx` gates on platform `owner|admin`, so a
platform-`member` group admin would be an administrator who cannot load the page that administers
their group. With this invariant every group surface stays under `/admin/*` behind the gate already
shipped, and no second gate has to be kept correct. It also matches the vision's own framing, where
the platform Admin role *is* the group-organizer role. The cost is that granting group-admin rights
is a two-step: the Super Admin promotes the person to platform Admin first.

#### Holding the invariant on platform demotion

An invariant enforced on one write path isn't an invariant. Group-role writes are only half of it —
the platform-role `PATCH` shipped in v0.1 can break it from the other side: demote the sole admin of
a group to platform `member` and that group is left with an `admin` row that grants nothing, since
`requireCohortRole`'s platform gate now rejects them. Only the Super Admin could ever administer that
group again, and no existing guard would have said a word.

So `PATCH /admin/api/users/:clerkUserId/role` gains a group-aware check, applied when the target role
is `member`:

- If the target is the **last admin of any group**, reject with `400` naming those groups — the same
  shape as `wouldRemoveLastOwner`, and the fix is the same: give that group another admin first.
- Otherwise **cascade** their `cohort_members.role` to `member` everywhere, in the same transaction
  as the platform-role write, so no stale admin row survives.

This modifies a route and tests that v0.1 already shipped. That is deliberate and worth the churn:
the alternative is a documented dead-end that only the Super Admin can dig a group out of. It needs
one new `CohortStore` read — the groups where a user is admin, with each group's admin count — which
is the same query the guard already wants.

## API Surface (Next.js Route Handlers, server-only, `packages/web`)

URLs and copy use **Group/Session**; only `core` says Cohort/Cycle. Session routes nest under their
group, so the guard has the group id in hand and a session that doesn't belong to the named group is
a plain `404`.

| Route | Auth | Notes |
|---|---|---|
| `GET /admin/api/groups` | platform `owner`/`admin` | `owner` sees all groups; `admin` sees groups they belong to |
| `POST /admin/api/groups` | platform `owner`/`admin` | `{ name }`. Creator is inserted as group admin **in the same transaction** |
| `GET /admin/api/groups/:groupId` | group member \| `owner` | group + members (Clerk identity joined) + sessions + pending invites |
| `PATCH /admin/api/groups/:groupId` | group admin \| `owner` | `{ name }` |
| `POST /admin/api/groups/:groupId/members` | group admin \| `owner` | `{ email }` — see invite flow |
| `PATCH /admin/api/groups/:groupId/members/:clerkUserId` | group admin \| `owner` | `{ role }`, last-admin guarded, invariant enforced |
| `DELETE /admin/api/groups/:groupId/members/:clerkUserId` | group admin \| `owner` | last-admin guarded |
| `DELETE /admin/api/groups/:groupId/invites/:invitationId` | group admin \| `owner` | revokes the Clerk invitation |
| `GET /admin/api/groups/:groupId/sessions` | group member \| `owner` | |
| `POST /admin/api/groups/:groupId/sessions` | group admin \| `owner` | `{ name, startsAt, endsAt, itemTypeKeys[], participantIds? }` |
| `PATCH /admin/api/groups/:groupId/sessions/:sessionId` | group admin \| `owner` | name, window, item types, participants |
| `POST /admin/api/groups/:groupId/sessions/:sessionId/close` | group admin \| `owner` | sets `closed_at` + `closed_by` |
| `POST /admin/api/groups/:groupId/sessions/:sessionId/reopen` | group admin \| `owner` | clears both |
| `GET /admin/api/item-types` | platform `owner`/`admin` | `?enabled=true` for the picker |
| `PATCH /admin/api/item-types/:key` | `owner` only | `{ enabled?, label? }` |

"Group member" in the Auth column means a member of that group who also clears the platform gate
above — in this slice, a platform Admin or Super Admin. Nothing under `/admin/api/*` is reachable by
a plain platform member.

### Session create/update validation

- `endsAt > startsAt` (also enforced by a table `CHECK`).
- At least one item type. Every key must exist **and be enabled** at write time.
- Every `participantIds` entry must be a current member of the group.
- **At least one participant.** Omitting `participantIds` on create defaults to all current group
  members; passing an explicit `[]` is a `400`, not a vacuous pass. A session nobody is in cannot be
  logged against, so it is a mistake worth catching at write time rather than a state to support.

### Removing a member from a group

Removal deletes the `cohort_members` row and, in the same transaction, the member's
`cycle_participants` rows **for that group's sessions that are not closed**. Closed sessions keep
their participant list intact — they are a record of who was there, and the logging slice will hang
totals off exactly those rows. Someone removed mid-trip stops being a participant going forward
without erasing the sessions they were part of.

### Self-service rules

Carried over from v0.1's platform behavior, and consistent with it:

- **Nobody changes their own role**, group role included — checked before the body is parsed, so a
  malformed body can never override it.
- **Self-removal is allowed**, unless the caller is the last admin — an organizer can leave a group
  they're done with, but cannot strand it.

### Invite flow — one door, two outcomes

`POST /admin/api/groups/:groupId/members` takes an email, validated against the same `@gmail.com`
rule as the platform invite. That check moves out of the invite route into a shared `lib/email.ts`
now that it has two callers.

- **Clerk user exists for that email** → insert `cohort_members` row with role `member`. Response
  says the user was added.
- **No Clerk user** → `clerkClient.invitations.createInvitation({ emailAddress, publicMetadata: {
  intendedRole: "member", intendedCohortId: groupId } })`. Response says an invitation was sent.

No pending-invite table. The metadata mechanism already exists (`intendedRole`, consumed by
`resolveRole`), and the admin's "pending" list is read back from Clerk's invitation list filtered on
`intendedCohortId` — which also avoids orphaned local rows for invites that are never accepted, the
same reasoning v0.1 used.

#### The metadata is consumed exactly once

On a user's first authenticated request, the join step runs alongside role resolution, then
**immediately clears `intendedCohortId`** via `clerkClient.users.updateUser`.

This is not optional bookkeeping. `getCurrentUserRole()` runs on every request; without clearing, a
member an admin just removed would be silently re-added on that member's next page load. `resolveRole`
avoids this because "an existing row wins" — the join has no such natural idempotence, so consumption
has to be explicit.

Order is insert-then-clear. If the clear fails, the rare consequence is a re-add on the next request;
the reverse order risks losing the membership entirely.

## Catalog seeding & deploy

`packages/web/vercel-build` currently runs `npm run migrate --prefix ../core && npm run build`. The
seed lives in web, so it becomes **migrate → seed → build**.

- `packages/web/src/lib/itemTypeCatalog.ts` — the emoji array (`key`, `emoji`, `label`, `position`),
  hand-maintained, no new runtime dependency.
- `packages/web/scripts/seed-item-types.ts` — idempotent `INSERT … ON CONFLICT (key) DO NOTHING`, so
  it never overwrites the Super Admin's enable/disable or relabel edits. Needs `tsx` as a web
  devDependency (core already has it), and loads env the same layered way `migrate` does.
- Local: `npm run migrate -w core && npm run seed -w web`, documented in the README next to the
  existing migration instructions.

This is a shipping requirement, not a nicety: with the min-one-item-type rule, an unseeded catalog in
production means **no session can be created at all**.

Per issue #27, Preview and Production still share one Neon database, so the seed lands in both. With
`ON CONFLICT DO NOTHING` that is harmless, and it stays harmless until the first destructive
migration — the same caveat already recorded in the README's Deployments section.

## UI Pages & Flows

Following the pattern v0.1 established: pages are server components that **read stores directly**
rather than fetching their own route handlers, client components are colocated in the route folder,
and the route handlers exist to serve client-side mutations.

`/admin` gains navigation: **Users · Groups · Item types**. The last is owner-only — hidden from the
nav for admins *and* 403'd server-side, never hidden-only.

- **`/admin/groups`** — table of groups (name, member count, live/scheduled session counts) plus a
  "New group" modal.
- **`/admin/groups/[groupId]`** — rename-able header; a Members section (identity, group-role select,
  remove, pending invites with revoke, add-by-email); a Sessions section (name, window, status badge,
  participant count, item emoji).
- **`/admin/groups/[groupId]/sessions/[sessionId]`** — name, start/end (`datetime-local`), an emoji
  multi-select grid drawn from the enabled catalog (minimum one, 🥭 preselected on create),
  participant checkboxes over current group members, Close/Reopen, and an "ended but not closed"
  banner for the overdue case.
- **`/admin/item-types`** — owner-only: enable/disable toggles and editable labels over the catalog.

Role controls follow v0.1's interaction model: optimistic update, rollback plus an error surface on
failure, and the caller's own row rendered disabled where the API would reject the write anyway.

## Error Handling

| Case | Behavior |
|---|---|
| Non-member hits a group route | `403`, no information about whether the group exists |
| Session id doesn't belong to the named group | `404` — not a `403`, so the two cases aren't distinguishable by probing |
| Last group admin removed or demoted | `400` with a clear message; guard runs before any write |
| Group-admin promotion for a platform `member` | `400` naming the fix: a Super Admin must promote them first |
| Caller changes their own group role | `403`, checked before the body is parsed |
| Session create with a disabled or unknown item type | `400`, field-level, no partial write |
| Session create with a participant outside the group | `400`, field-level |
| Invite email fails the gmail check | Inline field error, no Clerk call |
| Clerk API error (invite, revoke, metadata clear) | Surfaced with Clerk's own message, `502`, never swallowed |
| Session create with an empty participant list | `400` — an explicit `[]` is rejected rather than passing vacuously |
| No **enabled** item types (unseeded catalog, or the Super Admin disabled everything) | Session create is blocked with a message pointing at the catalog page, and at the seed step when the table is empty |
| Platform demotion of a group's last admin | `400` naming the affected groups; the platform role is not written |

## Testing

Mirrors the shipped convention exactly — real Postgres, fake only the Clerk boundary.

**`packages/core`** — unit tests for the pure pieces (`wouldRemoveLastCohortAdmin` in both variants,
status derivation including the overdue-but-live case), and store tests against a real local test
Postgres: cohort creation inserting the creator as admin atomically, membership CRUD, cycle CRUD with
participants and item-type links, close/reopen, catalog list and update.

**`packages/web`** — route handler tests against a test Postgres with the Clerk client faked:

- Guard behavior: non-member `403`, group admin passes, platform `owner` passes as superuser,
  unauthenticated `401`, and a **plain platform member who is a group member still gets `403`** from
  every group route — the platform gate is the newest rule here and the one most worth pinning.
- Group create inserts the creator as group admin.
- Member add: existing-user path vs. invitation path; gmail rejection.
- Last-admin rejection on both remove and demote.
- Platform-role invariant rejection on group-admin promotion.
- Self role-change rejection; self-removal allowed except as last admin.
- Removal clears participant rows on open sessions and leaves closed sessions' rows intact.
- Session create validation: inverted window, unknown key, disabled key, non-member participant,
  empty participant list, no enabled item types in the catalog.
- Platform demotion of a group's last admin is rejected; demotion of a non-last group admin cascades
  their group role to `member`.
- Close then reopen round trip.
- Item-types `PATCH` is owner-only.
- Pending-invite consumption: joins once, clears the metadata, does not re-add after removal.

No E2E in this slice, consistent with v0.1.

## Tracking

New milestone **`v0.2 — Groups & Sessions`**, created with
`gh api repos/pete-the-pete/mangoes/milestones` (there is no `gh milestone create`). v0.1 stays open
until its two stragglers (#26, #31) close; this milestone does not wait on them.

No E-tickets this time — v0.1 needed them for the Clerk app, hosted Postgres, and Vercel env vars,
which a human had to do in a dashboard. Everything in this slice is agent-executable.

### Proposed issues

| # | Task | Blocked by |
|---|---|---|
| 1 | Core — `cohorts` schema + types + `CohortStore` | — |
| 2 | Core — `wouldRemoveLastCohortAdmin` pure guard | 1 |
| 3 | Core — `cycles` schema + types + `CycleStore` (incl. close/reopen, status) | 1 |
| 4 | Core — `item_types` catalog schema + store | — |
| 5 | Web — emoji seed data, seed script, `vercel-build` wiring, README | 4 |
| 6 | Web — `requireCohortRole` guard + shared `lib/email.ts` | 1 |
| 7 | Web — groups API (list, create, get, rename) | 6 |
| 8 | Web — members API (add/invite, role change, remove, revoke) | 2, 6 |
| 9 | Web — pending-invite consumption on first sign-in | 1 |
| 10 | Web — sessions API (list, create, update, close, reopen) | 3, 6 |
| 11 | Web — item-types API (list enabled, owner-only PATCH) | 4 |
| 12 | Web — `/admin` nav + groups list + create UI | 7 |
| 13 | Web — group detail UI (members, invites, sessions list) | 8, 10, 12 |
| 14 | Web — session create/detail UI (emoji picker, participants) | 10, 11, 13 |
| 15 | Web — owner-only item-types admin page | 11, 12 |
| 16 | Web — hold the platform-admin invariant on platform demotion (reject last group admin, cascade otherwise) — **modifies the v0.1 role PATCH and its tests** | 1, 2 |

**Tasks 1, 3, and 4 all append to the same `schema.sql`.** They are logically independent but
textually collide, so they either merge in dependency order or take trivial conflicts on rebase —
exactly the branch-stacking question
[the milestone-execution doc](../plans/2026-08-22-milestone-execution-workflow.md) leaves open.

### Mechanics

Dependencies are recorded as `Blocked by #N` plain text in the issue body, per decisions already
locked in the milestone-execution doc. Issue numbers don't exist until creation, so it's two passes:
create all sixteen in dependency order, then `gh issue edit` the bodies with the real numbers.

Each issue body carries a link to this spec, a link to the plan doc, that task's acceptance criteria,
and its `Blocked by` line.

Board: run `gh project list --owner pete-the-pete` first to confirm #6 is the target — **never
`gh project create`**, given two prior sessions left stray boards behind. Then
`gh project item-add 6 --owner pete-the-pete --url <issue-url>` per issue, with Status set through
`gh project item-edit` using field ids read from `gh project field-list`. Unblocked tasks (1 and 4)
start in **Ready**; everything else in **Backlog**.

## Handoff

1. This spec is reviewed and committed, along with the product-vision corrections.
2. `Skill(writing-plans)` produces `docs/plans/2026-08-24-groups-and-sessions.md` with per-task
   acceptance criteria.
3. Milestone, issues, and board items are created **from that plan** — not before it exists, since
   writing acceptance criteria in two places is how they drift.
4. Implementation proceeds one branch/PR per issue, each with `Closes #N`.
