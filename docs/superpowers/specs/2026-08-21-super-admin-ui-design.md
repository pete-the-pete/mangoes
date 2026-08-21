# Super Admin UI — Design Spec

> **Status:** DRAFT
> **Author:** Pete (with Claude)
> **Date:** 2026-08-21

## Purpose

Build the first real, working slice of Mango Tracker: authenticated login via Clerk (Google OAuth) plus
an in-app admin UI for user/role management. This is the foundation the rest of the product's
invite-only auth model builds on, and the first thing to exercise the `packages/core` /
`packages/web` boundary with real code instead of a placeholder page.

This slice does **not** attempt groups, sessions, or logging (see the
[product vision](../../specs/2026-08-19-mango-tracker-product-vision.md)) — it is scoped to platform-level
identity and role administration only.

## Scope

### Must Have

- Login via Clerk, Google OAuth only, using Clerk's out-of-the-box UI components.
- A real `Role` concept (not a hardcoded allowlist): `owner` (Super Admin), `admin` (Admin), `member` (Member).
- First Super Admin bootstrapped automatically from a `SUPER_ADMIN_EMAILS` env var (Vercel-provided), no manual seed step.
- `/admin` UI, gated to `owner` and `admin` roles only (plain Members never see it):
  - List all users (Clerk identity data + role).
  - Super Admin (`owner`) can invite a new user by email, restricted to `@gmail.com` addresses, choosing their role (Admin or Member) at invite time.
  - Super Admin (`owner`) can change any existing user's role.
  - Admin (`admin`) sees the same list read-only — no invite button, no role controls.
- Guard: a Super Admin cannot demote themselves if doing so would leave zero `owner` users.

### Out of Scope (this slice)

- Groups, sessions, logging, leaderboards, notifications — everything else in the product vision.
- Mango/Mexico/beach visual theming — plain functional UI only.
- Restricting Google OAuth sign-in itself to gmail.com domains (only the *invite* flow is gmail-restricted).
- Full local user-profile sync (webhook-driven `users` table) — deferred; this slice reads identity live from Clerk on each admin page load.
- Any write permissions for `admin` role beyond viewing the user list.
- E2E/browser testing — deferred until more UI surface exists.

## Architecture

### `packages/core`

Adds a generic, domain-agnostic identity/roles module — legitimately core material, since any app
needs users and roles:

- **Role** — a generic 3-tier hierarchy: `"owner" | "admin" | "member"`. Core never uses the
  strings "Super Admin"/"Admin"/"Member" — those are `packages/web`-layer display labels mapped from
  the generic values (`owner → Super Admin`, `admin → Admin`, `member → Member`).
- **User** — `{ id: string /* Clerk user id */, role: Role, createdAt: Date, updatedAt: Date }`.
- **Persistence** — Postgres table `user_roles(clerk_user_id TEXT PRIMARY KEY, role TEXT NOT NULL, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`. This is the only local persistence for this slice.
- **Bootstrap logic** — given a Clerk user id + email, and a list of bootstrap emails (from env):
  if no `user_roles` row exists for that user id, and the email matches the bootstrap list, upsert
  `role = 'owner'`; otherwise leave unresolved (caller decides fallback, e.g. `member` or "no row yet").
- **Role-resolution function** — given a Clerk user id + email, resolves the effective `Role` in order:
  (1) existing `user_roles` row wins; (2) no row + email matches bootstrap list → upsert and return
  `owner`; (3) no row + a pending Clerk invitation for this user carries an `intendedRole` →
  upsert and return that role; (4) no row and neither of the above → upsert and return `member` as
  the safe default. The function always returns a concrete `Role`, never `undefined` — every
  authenticated user ends this call with a persisted `user_roles` row.
- **Last-owner guard** — a pure function `wouldRemoveLastOwner(currentRoles, targetUserId, newRole)` core
  can unit test in isolation, called by the web-layer role-change handler before persisting.
- Zero Next.js imports, zero domain nouns, per root `CLAUDE.md`.

### `packages/web`

- Clerk installed and configured with Google as the only enabled social connection; out-of-the-box
  `<SignIn/>`/`<SignUp/>` (invite-acceptance) components, no custom auth UI.
- `clerkMiddleware` protects `/admin/*`: unauthenticated → redirect to sign-in.
- Server-side role check on every `/admin/*` request: resolve effective role via `core`'s
  role-resolution function (which performs the bootstrap-upsert as a side effect on first
  qualifying request). If resolved role is not `owner` or `admin`, render a 403 page.
- Role-label mapping layer (`owner → "Super Admin"`, etc.) lives entirely in `packages/web` display code.

## API Surface (Next.js Route Handlers, server-only, `packages/web`)

All handlers use Clerk's backend SDK (`clerkClient`) server-side only — the Clerk secret key is
never exposed to the client.

### `GET /admin/api/users`

- Auth: `owner` or `admin`.
- Calls `clerkClient.users.getUserList()` for identity (email, name, avatar, created date), paginated
  per Clerk's defaults.
- Joins each user against `user_roles` by Clerk user id for `role`. A Clerk user with no `user_roles`
  row yet (invited but hasn't signed in for the first time, so role-resolution hasn't run for them)
  is labeled "Pending" in the UI rather than guessing a role.
- Returns merged list.

### `POST /admin/api/users/invite`

- Auth: `owner` only.
- Body: `{ email: string, role: "admin" | "member" }`.
- Validates `email` matches `@gmail.com` (case-insensitive domain match) — reject with a field-level
  error before calling Clerk if invalid.
- Calls `clerkClient.invitations.createInvitation({ emailAddress, publicMetadata: { intendedRole: role } })`.
- Does **not** pre-create a `user_roles` row (avoids orphaned rows for never-accepted invites).

### First-sign-in role commit (not a standalone endpoint — runs as part of the role-resolution path)

- The first time a user hits any authenticated route with no existing `user_roles` row, the
  role-resolution function (see Architecture above) runs its full fallback chain and persists the
  result — bootstrap match → `owner`; invitation `intendedRole` → that role; otherwise → `member`.

### `PATCH /admin/api/users/:clerkUserId/role`

- Auth: `owner` only.
- Body: `{ role: "owner" | "admin" | "member" }`.
- Before persisting, runs the last-owner guard (`wouldRemoveLastOwner`) against current `user_roles`
  state; rejects with a clear error if the change would leave zero owners.
- Upserts `user_roles`.

## UI Pages & Flows

- **`/admin`** — single page for this slice.
  - `owner`: full user table (avatar, name, email, role badge, joined date) + "Invite user" button.
    Each row has an inline role-select control that fires the PATCH endpoint on change, with
    optimistic UI update and rollback-on-error.
  - `admin`: same table, read-only — no invite button, no role controls rendered.
- **Invite modal** — email input + role select (`Admin` / `Member`, default `Admin`). Client-side
  gmail validation before submit; server re-validates regardless.
- No Mango-specific visual theming — Next.js/Tailwind defaults, functional only.

## Error Handling

| Case | Behavior |
|---|---|
| Invite email fails gmail validation | Inline field error; no API call made |
| Clerk API error on invite (rate limit, duplicate, invalid state) | Toast/banner surfaces Clerk's error message, not swallowed |
| Role PATCH fails (network, last-owner guard rejection) | Optimistic row update reverts; error toast shown |
| Non-owner/admin hits `/admin/*` | 403 page rendered server-side, no redirect loop |
| Unauthenticated hits `/admin/*` | Redirect to Clerk sign-in |

## Testing

- `packages/core`: unit tests for role-resolution/bootstrap logic and the last-owner guard, run
  against a real local test Postgres — no DB mocking.
- `packages/web`: route handler tests against a test Postgres, with the Clerk client faked at that
  boundary (external network dependency — reasonable seam to fake). Covers: invite validation
  rejection, successful invite, role PATCH success, role PATCH last-owner rejection, unauthorized
  access (401/403 paths).
- No E2E/browser tests in this slice.

## Handoff

**Next step:** `Skill(writing-plans)` to produce a step-by-step implementation plan from this spec,
split into GitHub issues under a milestone + project board for tracking.
