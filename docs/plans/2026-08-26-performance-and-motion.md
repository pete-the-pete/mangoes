# Make it fast, then make it fun

Tracked by [#97](https://github.com/pete-the-pete/mangoes/issues/97) (Phase 1) and [#98](https://github.com/pete-the-pete/mangoes/issues/98) (Phase 2).

## Context

Two complaints, in the order they must be fixed:

1. **Production pages are slow and clicking gives no feedback.** Confirmed on
   flora-mangos.com, not local dev. The cause is structural, not mysterious —
   see the evidence below.
2. **The UI isn't fun.** Things should fly in and click into place, and logging
   a mango should fire one of the celebrations from the design session.

Perf comes first because the animation work sits on top of it: page-transition
motion needs route-level Suspense boundaries to hang off, and a celebration
layered on a screen that already feels sluggish reads as more lag, not delight.

### The single most important finding

**The celebration is already written in CSS and imported by nothing.**
`globals.css:125-307` has all 13 `@keyframes` — `rocket-up`, `flame`, `burst`,
`clash-l`, `clash-r`, `star-pop`, `flash-bg`, `word-out` — ported verbatim from
the prototype with the exact easings from `docs/design/handoff.md:207-220`. The
`--animate-*` tokens exist. `text-stroke-*` (the word mark's outline) exists.
`cn.ts:89-105` already whitelists all seven celebration animations for
tailwind-merge. What is missing is a React component to fire them.

So this is not "add an animation library to the tap path." It's "build
`CelebrationLayer` against CSS that's already done," plus a separate, genuine
use of `motion` for the fly-in work.

### Evidence for the perf claims

Measured on production:

| Signal | Value |
|---|---|
| Signed-out `/` TTFB | ~195ms |
| Static `/offline` TTFB | ~90ms |
| Next JS chunks on landing page | ~246KB compressed |
| Clerk `clerk.browser.js` + `ui.browser.js` | ~124KB compressed, from a satellite domain |
| Function region | `iad1` (edge `pdx1`) |

Counted in the code (these are facts, not estimates):

- **`loading.tsx` files in the entire app: zero.** Also zero `error.tsx`, zero
  `<Suspense>`. With no boundary, an App Router navigation blocks on the full
  server render before the browser paints anything — the old page just sits
  there. This is the whole mechanism behind "no indication anything is happening."
- **`useTransition`, `useOptimistic`, `useFormStatus`: zero occurrences.**
  `router.refresh()` appears at 8 sites and is never awaited, so the busy states
  that *do* exist (`SessionForm`, `AccountNameForm`, `AdminLogControl`) clear
  before the re-render lands, and several surfaces (`ItemTypeTable`,
  `AdminUserTable` role change, `MembersPanel.mutate`) have no busy state at all.
- **`clerk.users.getUser()` runs on every authenticated request**
  (`lib/auth.ts:22`), across 16 call sites — including `lib/cycleAuth.ts:24`,
  which guards every mango POST, every `/snapshot`, and every `/stream`. Opening
  one session screen costs ~3 Clerk round trips and ~12 DB queries.
- **`admin/layout.tsx:16` and every admin page each call
  `getCurrentUserRole()`** — two identical Clerk round trips per admin render.
- **`listCyclesForCohort`** (`packages/core/src/cycles/cycleStore.ts:151-164`)
  is a sequential `for` loop over `readDetail`, which is itself 3 sequential
  queries. A group with 20 sessions = 61 serialized round trips. Its sibling
  `listCyclesForParticipant` (`:216-227`) already uses `Promise.all` — copy it.
- **`db.ts:11` is `new Pool({ connectionString })` and nothing else** — no `max`,
  no timeouts, no `globalThis` singleton guard.
- **No caching anywhere**: one `export const dynamic` in the whole app (the SSE
  route). No `revalidate`, no `use cache`, no `unstable_cache`, no PPR.

**Measurement caveat:** `vercel logs` returned no duration column and only my own
probe traffic, so I have no measured latency for authenticated pages. The
ranking below is by round-trip count, which is countable from the source. Real
before/after numbers are a verification step, not an input.

**Do not "fix" the region.** The function runs in `iad1` while the edge is
`pdx1`. That is correct — these pages make 3 Clerk round trips and ~12 DB queries
each, so the function belongs next to Neon, not next to the user. Moving it west
would multiply the dominant term.

---

## Decisions taken

- **CSS stays on the tap path; `motion` earns the fly-in work.** The repo has a
  documented anti-JS-animation policy for the core loop (`TapTarget.tsx:80-83`,
  `UndoToast.tsx:27`, the v0.4 commit message), and the celebration keyframes are
  already written and transform-only. Rebuilding them in `motion` is pure cost.
  `motion` gets the staggered entrances, layout transitions, and page transitions
  — what CSS is actually bad at, and what "fly in and click into place" describes.
  This makes the currently-dead `motion` dependency earn its place.
- **Clerk fast path via a session-token claim** (user is making the dashboard
  change).
- **Celebration origin is hybrid**: screen-centered rocket/confetti/clash/flash/
  word mark, plus a local scale-pop on the tapped tile so grid layouts still feel
  locally responsive.
- **Branch fresh off `main`.** `feat/group-admin-participant-view` (`a441f0f`)
  stays parked; it touches the admin session page, so expect a conflict there
  later.

---

## Phase 1 — Performance and feedback

### 1.1 Kill the per-request Clerk round trip

**Prerequisite (user action):** Clerk Dashboard → Sessions → Customize session
token, add:

```json
{ "metadata": "{{user.public_metadata}}" }
```

Then in `packages/web/src/lib/auth.ts`, restructure `getCurrentUserRole`:

```ts
const { userId, sessionClaims } = await auth();     // no network call
if (!userId) return null;

const existing = await userRoleStore.getRole(userId);   // one indexed DB query
const meta = (sessionClaims?.metadata ?? {}) as Record<string, unknown>;

// Fast path: known user, nothing pending. Zero Clerk calls.
if (existing && !hasPendingInvite(meta)) {
  return { clerkUserId: userId, role: existing };
}

// Slow path: unchanged from today — getUser() for authoritative metadata,
// resolveRole, joinPendingCohort, applyPendingInviteName.
```

Why this is safe: `resolveRole`
(`packages/core/src/roles/resolveRole.ts:20-25`) already returns early on an
existing row, so `email` and `intendedRoleFromInvitation` are only consulted on
first sight. The fast path triggers only when the token says nothing is pending;
a **stale-positive** claim just costs one extra Clerk call and then takes today's
authoritative path, so it can never produce a wrong write. Declare the claim
shape via a global `CustomJwtSessionClaims` interface (Clerk's is `[k: string]:
unknown` by default) so `sessionClaims.metadata` is typed.

**Known limitation to state in the PR:** session tokens refresh roughly every
60s, so if an admin invites an *already signed-in* user to a group, consumption
happens up to a minute later instead of on the next request. Acceptable — and
strictly better than the current failure mode, where a failed metadata clear
re-adds a removed member on every request forever.

`hasPendingInvite` is a pure function — put it in its own module so it's
unit-testable in the node-env test setup. It checks `intendedCohortId`,
`intendedFirstName`, and `intendedLastName`.

**Decision on `intendedRole`: deliberately excluded from the check, with a
comment in the function saying so.** Unlike the other three keys, nothing ever
clears `intendedRole` — so including it would push *most invited users*
permanently onto the slow path, defeating the optimization. It is safe to omit
because `resolveRole` only reads it when there is no `user_roles` row, and the
fast path already requires `existing`. The comment matters: if someone later adds
a path that re-resolves role for an existing user, this omission silently becomes
a bug.

**Also state in the PR (already true today, not a regression):** once a
`user_roles` row exists it wins forever, so `resolveRole` never re-checks
`email` against `BOOTSTRAP_EMAILS`. Changing `SUPER_ADMIN_EMAIL` after a user's
first sign-in has no effect. Saying this out loud stops someone "fixing" the fast
path later to re-read email on every request and reintroducing the round trip.

### 1.2 Request-scoped dedupe

Wrap `getCurrentUserRole` in React's `cache()`. Two lines; eliminates the
`admin/layout.tsx:16` + per-page duplicate entirely. Do this even though 1.1
lands — they compose, and this one carries no risk.

### 1.3 Route-level loading states — the fix for "nothing happens when I click"

Add `loading.tsx` at the route-group level, which covers most routes in two files:

- `packages/web/src/app/(member)/loading.tsx`
- `packages/web/src/app/admin/loading.tsx`

Plus `packages/web/src/app/(member)/sessions/[sessionId]/loading.tsx`, since the
core screen deserves a shaped skeleton rather than a generic one.

Build a `Skeleton` primitive in `src/components/ui/` using the **already-defined,
currently-unused `--animate-shimmer` token** (`globals.css:132`, whitelisted at
`cn.ts:96`). Compose skeletons from the real `Card`/`PageShell` primitives so
they match the sticker design system rather than looking like generic grey bars.

**Design these knowing Phase 2 adds `motion` page transitions** — the skeleton is
what the transition animates *out of*, so pick its layout once.

Also add `packages/web/src/app/error.tsx` and `not-found.tsx` — currently a
thrown error in any server component produces the bare Next default.

### 1.4 One pattern for every mutation surface

Replace the bare `router.refresh()` at all 8 sites with:

```ts
const [isPending, startTransition] = useTransition();
// ...
startTransition(() => router.refresh());
```

`isPending` stays true until the server re-render actually lands, which fixes
both failure modes at once — the surfaces with no busy state, and the ones that
clear too early. Wire it into the existing `Button` `disabled` prop.

Files: `admin/item-types/ItemTypeTable.tsx`, `admin/AdminUserTable.tsx`,
`admin/groups/[groupId]/MembersPanel.tsx`, `admin/groups/GroupsTable.tsx`,
`admin/groups/[groupId]/sessions/SessionForm.tsx`,
`.../[sessionId]/AdminLogControl.tsx`, `(member)/account/AccountNameForm.tsx`,
`app/SessionChooser.tsx`.

**Do not touch the member log path.** `TapTarget` + `useSession` + the IndexedDB
outbox is genuinely well-built optimistic UI — CSS `:active` press, counts folded
from pending ops before any network call, `UndoToast`, `SyncBadge`. It does not
use `useOptimistic` and does not need to.

### 1.5 Database round trips

- `listCyclesForCohort` (`cycleStore.ts:151-164`) → `Promise.all`, mirroring
  `listCyclesForParticipant` at `:216-227`. Called by both `/groups/[groupId]`
  and `/admin/groups/[groupId]`.
- `readDetail` (`cycleStore.ts:86-113`) → collapse 3 sequential queries into one
  using json aggregation for participants and item types. This is the multiplier
  on every cycle read.
- `db.ts:11` → `globalThis` singleton guard + explicit `max` and timeouts.
- `listPendingGroupInvites` (`lib/adminGroups.ts:36-40`) fetches *every* pending
  Clerk invitation and filters in JS — it grows with total invites, not with the
  group. Paginate or filter server-side.
- Cache the near-static item-type catalog: `itemTypeStore.listItemTypes()` is
  re-fetched on every render of 8 different pages.

**Verify (cannot be read from the repo):** that the production `DATABASE_URL`
points at Neon's `-pooler` (PgBouncer) host, not the direct compute host. With
per-instance pools this is the difference between working and exhausting Neon's
connection limit under concurrency.

---

## Phase 2 — Motion

### 2.1 `CelebrationLayer` — the headline feature

`docs/design/handoff.md:20` calls this "the retention mechanic, not decoration."
Pure CSS, no `motion`.

Extract the logic as **pure functions in their own module** (the repo's
established pattern — see `pickLayout` in `TapTarget.tsx` and `pickTapToast` in
`lib/tapToast.ts`), because there is no jsdom/RTL/Playwright in this repo and
pure functions are the only testable surface:

- `pickEffect(random, forced?)` → `'rocket' | 'confetti' | 'clash'`, with a QA
  force-override as the prototype has (`Mango Tracker.dc.html:537-591`).
- `generateParticles(random)` → 34 particles with inline `--dx`/`--dy`/`--rot`,
  angle over 2π, distance 130–390px, size 18–52px, rotation ±450°, duration
  0.8–1.3s, stagger 0–0.18s, vertical bias −80px.

The component renders the flash + effect + Anton 74px word mark (`BLAST OFF!!` /
`MANGO RAIN!!` / `KA-CHUNK!!`), then clears state at 1500ms.

Non-negotiables from the handoff:

- **The effect must never gate or delay the count increment.** It hangs off the
  existing optimistic path fire-and-forget; `client.ts:476-482` already emits
  before any network call.
- **Reduced-motion variant = flash + word mark only, no particles.** The 34
  particles are generated in JS so there is no CSS-only off-ramp, and no
  `matchMedia` hook exists anywhere today. Use `motion`'s `useReducedMotion` —
  this is the one place the library touches the tap path, and only as a media
  query read, not an animation driver.
- While there, fix the existing inconsistency: `flame` is behind the
  reduced-motion gate (`globals.css:364-376`) but `rocket-up` is not, so a
  reduced-motion rocket currently flies flameless.
- Add a tile-local scale-pop on the tapped `TapTarget` (per the hybrid decision),
  so 2–4 and 5+ grid layouts feel locally responsive. New keyframe → **must be
  added to both `globals.css` `@theme` and the `animate` array in `cn.ts:89-105`,
  or tailwind-merge silently breaks and `cn.test.ts` fails.**

Iterate on `/design` — it's dev-only (`design/page.tsx:25` calls `notFound()` in
production) and needs no auth and no DB, so it's by far the fastest render loop.

### 2.2 Fly-in and click-into-place — where `motion` earns its keep

- Staggered entrance for list and grid children: `SessionGroups`/`SessionCard`,
  `Leaderboard` rows, `EntryList` rows, admin tables, the `TapTarget` grid.
- `layout` transitions so leaderboard rows slide when the order changes, rather
  than snapping.
- `AnimatePresence` page transitions between routes, animating out of the Phase
  1.3 skeletons.
- Overshoot easing consistent with the design system's existing
  `cubic-bezier(.2,1.6,.4,1)` (used by `--animate-pop-in` and the handoff's
  progress-fill spec) so the "click into place" feel is one system, not
  per-component invention. Consider promoting it to a named easing token — there
  are no standalone easing tokens today, only curves baked into `--animate-*`
  shorthands.

**Client-boundary constraint:** `Card`, `Pill`, `Avatar`, `Leaderboard`,
`SessionCard`, `NavBar`, `PageShell`, `TapTarget` are all server components
today, and `NavBar.tsx` documents refusing an active-tab indicator specifically
to avoid a client boundary. Animating these means introducing one. Wrap with a
thin client `motion` wrapper around server-rendered children (`<Stagger>{...}
</Stagger>`) rather than converting the primitives themselves to `"use client"`.

### 2.3 Read before touching the designs

`docs/design/README.md` has a "where the designs and the code deliberately
disagree" table — attribution pills, the `/100 TO THE GOAL` thermometer, and the
ranked leaderboard are all rejected on purpose. Don't smuggle them back in while
animating. Note also that `Mango Tracker.dc.html` is "the pixel source of truth —
it wins over the prose whenever they disagree."

---

## Explicitly out of scope

- **`cacheComponents` / PPR in `next.config.ts`** — a migration with
  dynamic-rendering fallout, not a perf tweak. Verify its semantics on Next 16.3
  before anyone reaches for it.
- **The SSE 2s-poll redesign** (`api/sessions/[sessionId]/stream/route.ts:11`,
  30 queries/min per viewer). Real, but a scale concern, not today's PLT complaint.
- **Bundle size.** ~246KB Next + ~124KB Clerk is not trivial, but client
  boundaries are already placed leaf-ward and correctly. Not the bottleneck.
- **Commissioning the mango vector.** `docs/design/README.md` notes the emoji
  "can't be squashed/rotated convincingly" and the celebration wants a real
  vector with idle/squashed/rocket variants. Ship with the emoji; flag it.
- **Milestone confetti** (group crosses 100) — a separate, deferred Could-Have in
  `product-vision.md:161`. Not the per-tap celebration.

---

## Verification

**Before/after measurement (this is the point — no authenticated-page latency has
been measured yet):**

1. **Baseline, before any change, via the DevTools network panel** on a signed-in
   preview deploy — record TTFB on the *document* request for `/`,
   `/sessions/[id]`, `/groups/[id]`, `/admin/groups/[id]`, and the POST to
   `/api/sessions/[id]/entries`. Use DevTools, not `curl`: Clerk's `__session`
   cookie is httpOnly and short-lived, so a replayed cookie expires mid-run.
2. **For the entries POST specifically**, wrap `requireCycleParticipant` in a
   temporary timing log and read it back with
   `vercel logs <deployment-url> --scope pete-the-petes-projects` (verified
   working). This is the number that isolates the Clerk round trip from
   everything else, and it's where the 1.1 fix should show most clearly.
3. Re-measure both after Phase 1, then remove the temporary log.

**Automated:**

- `npm run test -w web` and `npm run test -w core` — in particular `cn.test.ts`,
  which is the guard against `globals.css`/`cn.ts` drift, and `tapToast.test.ts`.
- New unit tests for `pickEffect`, `generateParticles`, and `hasPendingInvite`.
- `npm run build -w web` — this is the **only** typecheck for `packages/web`; CI
  has no lint step because `npm run lint -w web` is broken under TS 7 (issue #21).

**Manual:**

- `npm run dev -w web` → `/design` for the celebration, with the QA force-override
  to hit each of the three effects deterministically.
- Toggle OS reduce-motion and confirm the reduced variant (flash + word only) and
  that no rocket flies without its flame.
- Verify the invite paths still work end to end after 1.1: invite a brand-new
  user with a name and a group, accept, confirm role, group membership, and name
  all land.
- Click every mutation surface from 1.4 and confirm a visible busy state that
  persists until the new data is on screen.
- Confirm `/design` still 404s in a production build.

---

## Process

Per `CLAUDE.md`: run `gh project list --owner pete-the-pete` first — Project #6
"Mangoes" is the only board, and prior sessions created stray duplicates.

Two issues, both on Project #6, both linked to this plan file:

1. **perf:** page load latency and missing interaction feedback (Phase 1)
2. **feat:** celebration on log + motion pass (Phase 2)

Branch off `main`, one PR per phase, `Closes #N` in each body.
