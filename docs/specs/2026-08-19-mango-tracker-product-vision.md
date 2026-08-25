# Mango Tracker — Product Vision

> **Status:** DRAFT
> **Author:** Pete
> **Date:** 2026-08-19

## TL;DR

A small-group counting game for real life: an admin sets up a time-boxed session (a beach day, a trip, a party), defines what's being counted (mangoes, margaritas, tacos), and invites people from their group. Everyone logs consumption in one tap and watches a live, fun leaderboard. The engine behind it is a generic, domain-agnostic library (`packages/core`) so the same foundation can power future themed apps beyond mangoes — but the only thing shipping in v1 is **Mango Tracker**, which goes hard on Mexico/beach/tropics identity.

## Problem

### Who

- **Super Admin (Pete, initially):** the platform owner. Wants to control who gets in at all, and hand out trust to a small number of admins without babysitting every invite.
- **Group Admin:** the organizer of a friend group (e.g. "the annual Cabo trip crew"). Wants to stand up a session in under a minute before everyone's phones come out, and get a shareable, funny recap afterward without doing manual tallying.
- **Member/Participant:** a friend along for the trip. Wants to log "I ate a mango" in one tap without breaking the conversation, and check the leaderboard to talk trash.

### What

Friend groups already informally count this stuff ("how many mangoes has Dave eaten today?") via group chat guesswork, sticky tallies, or nothing at all — so the count is inaccurate, arguments happen, and nobody gets a satisfying recap. Group admins struggle with having no lightweight, invite-only way to run a shared live tally for a group of friends over a bounded time window, resulting in lost bragging rights, no record of past trips, and manual counting via text threads.

### Evidence

This is a personal/friends project, not market-validated — evidence here is Pete's own experience running this informally (group chat tallies) and the explicit brief. Confidence in the core loop is high (it's a known, played-out social pattern — see Research below); confidence in specific feature bets (offline sync importance, shared-item semantics) is validated by direct product-owner decision below, not user testing.

### Why Now

Pete is building this as a personal project and wants the foundation (`packages/core`) built correctly from day one — extracted-package discipline — because the mango app is intentionally the first of what could become a family of themed counting apps (the CLAUDE.md architecture boundary already anticipates this).

## Solution

### Jobs to Be Done

- **Functional:** "When I'm at the beach with friends and someone eats a mango, I want to log it in one tap, so the group has an accurate running count without anyone doing manual math."
- **Functional:** "When I'm organizing a trip, I want to spin up a session and invite my group in under a minute, so people can start logging before the moment passes."
- **Emotional:** "When the session ends, I want a fun, shareable recap, so we get to relive and laugh about the trip together — like a fundraiser thermometer crossed with a scoreboard."
- **Social:** "When I'm winning the leaderboard, I want everyone to see it live, so I get to talk trash in the group chat."

### Core Experience

#### Entry Point

- Invite-only: a user receives a Clerk-backed invite (platform invite from an admin, or a group/session invite from a group admin) and lands directly in the relevant group/session after accepting.
- Installed as a PWA from a mobile browser (add-to-homescreen), so return visits open like a native app, not a bookmark.

#### Happy Path (Member logging)

1. Member opens the app (or gets a push/notification that a session is live) and sees their **current session** front and center — a big, tappable item (🥭) with a live running total.
2. Member taps the item, confirms "for me, alone" or "shared with the group" (defaults to individual), confirms the session (defaults to their current-session toggle).
3. The tap registers instantly on-device (optimistic UI) even with no connectivity, and the log queues for sync.
4. Member sees their personal count and the group leaderboard update immediately (locally; syncs to others when connectivity allows).
5. At any point, member can view the live leaderboard/report — running totals, a fun progress visualization, and a per-person breakdown.

#### Happy Path (Admin setting up a session)

1. Group admin creates a session: name, time box (start/end), and the item type(s) to track (seeded with mango; can add margarita, taco, etc.).
2. Admin invites members from their group to the session (defaults to whole group, can subset).
3. Session goes live at start time; admin can log on behalf of any member, or log "for the group" (untagged), at any point.
4. The time box is a soft deadline: when it ends, the session stays open and the admin is prompted to close it. Closing is an explicit admin action, and it is what locks the session to individual edits. Admin can still log/edit/correct entries after close; every such edit is recorded and visible in a detailed audit view on the report.

#### Feedback

- Every tap gives immediate, satisfying feedback (count ticks up, leaderboard animates) even offline — sync state (queued vs. synced) is visible but never blocking.
- Session close triggers a "recap" moment — the fun report, front and center, not buried in a menu.
- Other participants' logs appear on your device without you doing anything: near-real-time on wifi, and caught up automatically the moment you reopen/foreground the app otherwise. See "Propagation & Consistency" below.

#### Propagation & Consistency

Group stats are a **derived view over the append-only event log**, not pushed state — any client can reconstruct correct totals by replaying events it hasn't seen yet. This is what actually guarantees everyone converges on the same numbers; live-push is a feel enhancement layered on top, never a correctness dependency.

- Each client tracks a **sync cursor** (last event it has seen) per session, and pulls the delta since that cursor on reconnect, app foreground/resume, and periodically while open.
- When on wifi (detected via the Network Information API where supported), the client opens an SSE connection for near-real-time push of new events — SSE reconnects automatically on drop, so this isn't a fragile persistent-connection commitment.
- When on cellular, or when connection type can't be reliably detected (notably inconsistent on iOS Safari — treat "unknown" as cellular-conservative, not wifi), the client falls back to interval polling on a longer cadence instead of holding a live connection, to avoid burning someone's mobile data.
- Members who aren't present or don't have the app open get pulled back in via session-lifecycle notifications (see below), which trigger a full resync on open.

#### Error States

| Error | User sees | Recovery |
|-------|-----------|----------|
| Log attempted while offline | Log registers locally with a "pending sync" indicator | Auto-syncs when connectivity returns; no user action needed |
| Sync conflict (rare — see Assumptions) | Not surfaced as an error; append-only event log avoids most conflicts by design | Admin can see/correct in the audit view if something looks wrong |
| User tries to edit a log after session close | Edit blocked with a message that only the session admin can amend closed sessions | User pings the admin, or admin self-serves the correction |
| Invite link invalid/expired | Clear "this invite isn't valid" state, no silent failure | User requests a new invite from an admin |
| No active/current session set | Prompted to pick or ask an admin to add them to one | N/A — informational state, not a hard error |

### What This Is NOT

- Not a public, no-login social app — invite-only end to end, no discovery surface. (Public read-only share links are an explicit fast-follow, not v1 — see Won't Have.)
- Not a payments/wagers/betting product. That's a plausible *future* themed app on the same core library, but explicitly out of scope for this product and this spec.
- Not a no-code theme builder — "heavy customization" means the core library exposes the right seams for a developer to build a new themed app (like Mango Tracker), not a UI for non-engineers to skin their own app.
- Not a fitness/habit tracker — it's bounded to time-boxed sessions, not open-ended daily tracking.

## Research

### Competitive Patterns

| Product/Pattern | Approach | Strength | Weakness |
|---|---|---|---|
| Untappd | Individual check-ins + counts, social feed | Frictionless single-item logging | No time-boxed group sessions or shared leaderboard-per-event |
| Fundraiser thermometers (GoFundMe-style) | Big, satisfying progress-toward-goal visualization | Instantly readable, emotionally engaging | Single aggregate number, no per-person breakdown |
| Splitwise | Groups + shared/individual attribution of an amount | Solves the "shared vs. individual" split problem well | Built for money, heavier UX than a single tap needs |
| Beer Olympics / drinking-game trackers | Live leaderboard during a bounded event | Matches the "session" mental model exactly | Usually single-event, no persistent group/history across sessions |

### User Expectations

- One-tap logging is table stakes — any friction (extra confirmation screens, forms) will kill adoption in a live social setting. Meet this expectation hard.
- A live leaderboard during the event, not just a post-hoc summary, is what makes this fun rather than just a spreadsheet. Meet this expectation.
- Shared/individual attribution is a known hard problem (Splitwise proves it can get complex) — we're deliberately breaking new ground *simpler* than Splitwise here (see Scope), not copying its full split-precision model.

## Scope

### Must Have (v1)

**Platform / accounts**
- [ ] Clerk-backed invite-only auth; no self-serve signup
- [ ] Roles: Super Admin (initially Pete), Admin, Member
- [ ] Super Admin can invite users and designate Admins
- [ ] Admins can create groups and invite users to their groups. Inviting a *new* email to a group
  sends the platform invitation as a side effect, so admins never need direct access to the platform
  user list — that stays Super-Admin-only (resolved 2026-08-24, see the
  [Groups & Sessions design spec](2026-08-24-groups-and-sessions-design.md))
- [ ] Users can belong to multiple groups and multiple sessions simultaneously

**Groups & sessions**
- [ ] Admins define sessions as time boxes scoped to a group
- [ ] Sessions define one or more trackable item types (e.g. mango, margarita, taco)
- [ ] Admins invite a subset or all of their group's members to a session
- [ ] A global "current session" toggle drives the default session context for logging

**Logging**
- [ ] One-tap logging of an item against the current session (or an explicitly chosen session)
- [ ] Each log declares individual vs. shared attribution: individual = +1 to that person and the group; shared = +0 to the individual, +1 to the group only (simple model — see Won't Have for the deferred "advanced" attribution mode)
- [ ] Session admin can log on behalf of any member, or log untagged "for the group"
- [ ] Members can edit/delete their own logs while the session is live
- [ ] Only the session admin can edit logs after the session closes; all such edits are recorded and visible in a detailed audit/report view
- [ ] Offline-first logging: taps queue locally (no connectivity or wifi-only environments) and sync automatically when a connection is available; append-only event log design to avoid write conflicts
- [ ] Eventual consistency across group members via a sync-cursor + event-replay model (see Propagation & Consistency above); near-real-time push via SSE when on wifi, falling back to interval polling on cellular/undetectable connections — correctness never depends on the live-push layer
- [ ] Session-lifecycle notifications (in-app + OS push): session opens, session closing soon, session closed/recap ready — the main mechanism for pulling in group members who aren't physically present or don't have the app open

**Reporting**
- [ ] Live running totals and a leaderboard, visible to all session participants, for a live session
- [ ] Fun visualizations beyond a plain table (progress-bar/thermometer style, per-person breakdown) — exact visual language owned by design phase
- [ ] Users can browse and view past (closed) sessions and their reports
- [ ] Closed-session reports include a detailed/audit view showing any post-close admin edits

**Product identity**
- [ ] `packages/core` ships as a generic, domain-agnostic library with no mango/app-specific concepts baked in (per architecture boundary in root CLAUDE.md)
- [ ] `packages/web` skins core hard with Mango/Mexico/beach/tropics visual identity — this is the primary differentiator of v1 and should not read as a generic themed template
- [ ] Installable PWA, mobile-first responsive layout, usable one-handed

### Should Have (v1 if time, else v1.1)

- [ ] Overtake/milestone notifications ("Dave just passed you," "group hit 100 mangoes") — deferred from Must Have because they need throttling/debounce logic (don't spam everyone on every single tap) that's easy to get wrong under time pressure; session-lifecycle notifications alone cover the "pull in remote friends" job for v1
- [ ] Shareable (but still authenticated, invite-only) recap view/image for a closed session
- [ ] Session templates (reusable item-type sets, e.g. "Beach Day" preset with mango + margarita)
- [ ] Per-item-type icons/visuals within a session when multiple item types are tracked

### Could Have

- [ ] Light delight: haptics/confetti on milestones (e.g. group crosses 100 mangoes)
- [ ] Achievement badges across sessions (e.g. "Mango King" for most all-time)

### Won't Have (this version)

- [ ] Public, no-login share links for leaderboards/reports — deliberate fast-follow after v1, not a v1 requirement
- [ ] "Advanced" group mode with subgroup/fractional shared-consumption attribution — v1 keeps the simple 0-for-individual/1-for-group model; fractional/subgroup credit is an explicitly deferred future concept
- [ ] Self-serve signup / open registration — not deferred, permanently out of scope; invite-only is core to the product, not a v1 limitation
- [ ] Payments, wagers, or betting mechanics — belongs to a hypothetically different themed app on the same core, never this one
- [ ] No-code theming UI for non-engineers — core's customization surface is a developer-facing API/theming layer, not an admin-facing skin builder

## Success Criteria

| Metric | Target | Measurement |
|---|---|---|
| Log friction | Median time from opening the app to a logged item < 5 seconds | Client-side timing from app-open (or resume) to successful log event |
| Session engagement | ≥ 80% of invited session participants log at least one item during the session window | Ratio of unique loggers to invited participants per session |
| Recap engagement | ≥ 80% of session participants view the closed-session report within 48 hours of close | View events on the report screen scoped to session participants |
| Offline reliability | 0% silent data loss for offline-queued logs across a session's wifi-only usage | Manual/QA verification: queue N logs offline, confirm N synced logs post-reconnect |
| Admin setup speed | Median time for an admin to create a session and send invites < 60 seconds | Client-side timing from "create session" start to invites sent |

## Assumptions and Risks

| Assumption | Confidence | Validation plan |
|---|---|---|
| Friends will tolerate invite-only friction because it's a private, fun context | High | This is a deliberate design constraint, not a hypothesis to test |
| A single global "current session" toggle is sufficient even though users can be in multiple concurrent sessions | Medium | Revisit if real usage shows people frequently in 3+ concurrent live sessions and mis-logging to the wrong one |
| Offline sync conflicts will be rare because logs are simple append-only increment events, not mutable shared documents | Medium | Confirmed by data-model choice (event log, not mutable counter); revisit if edit/delete-after-sync scenarios prove messy |
| The simple 0/1 shared-attribution model is "fun enough" without fractional credit | Medium | Ship simple model first; watch for repeated user requests for "who actually shared it" before building the advanced mode |

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Offline-first sync becomes a much bigger engineering lift than expected (this is the one genuinely Type-1-ish technical bet in this spec) | Medium | High | Model all logs as immutable, append-only events (not mutable counters) from day one in `core`; this avoids most conflict-resolution complexity by construction. Treat as a core-library design constraint, not an app-layer bolt-on. |
| Connection-type detection (wifi vs. cellular) is unreliable on some browsers, notably iOS Safari | Medium | Low | Default "unknown" to cellular-conservative (polling, not SSE); the sync-cursor/event-replay model still guarantees correctness regardless of which path a given device takes, so a mis-detection only costs some liveness, never correctness |
| Heavy Mango-app theming tempts engineers to leak domain-specific styling/concepts into `packages/core` | Medium | Medium | Enforced by the existing CLAUDE.md architecture boundary; consider standing up the proposed `core-boundary-checker` agent early, per CLAUDE.md's own guidance |
| Admin-only post-close editing becomes a support burden if audit trail isn't clear | Low | Medium | Detailed audit view is a v1 Must Have, not deferred |

## Open Questions

- [x] **Resolved 2026-08-24:** a group can have **multiple admins**, carried as a per-group role
  alongside the platform role. A group admin must also hold the platform Admin role. See the
  [Groups & Sessions design spec](2026-08-24-groups-and-sessions-design.md).
- [x] **Resolved 2026-08-24:** closing is an **explicit admin action**; the time box is a soft
  deadline that prompts but never changes state on its own. A session past its end time is still
  live until someone closes it. See the
  [Groups & Sessions design spec](2026-08-24-groups-and-sessions-design.md).
- [ ] Should Members be able to see who invited them / the full member list of a group, or is group membership itself semi-private? — Pete, can defer to design phase.

## Handoff

### For Technical Planning

**Problem:** Friend groups have no lightweight, invite-only way to run a shared, time-boxed live tally with an accurate record and a fun recap — they resort to group-chat guesswork or manual tallying.
**Goal:** Ship Mango Tracker — an invite-only, mobile-first PWA where a group admin runs a time-boxed session, members one-tap log consumption (individual or shared), and everyone gets a live leaderboard plus a fun closed-session recap — built on a generic, extractable `packages/core` counting/session engine with zero app-specific concepts.
**Scope:** See Must Have list above; explicit exclusions in Won't Have (no public links, no fractional shared-attribution, no self-serve signup, no payments/wagers, no no-code theming).
**Success Criteria:** See table above (log friction < 5s, ≥80% session participation, ≥80% recap views, zero offline data loss, <60s admin session setup).

**Technical constraints:**
- Clerk for auth/invites; invite-only enforced at the auth layer, not just UI
- Offline-first logging is a Must Have — architect the event/log model as append-only from the start (see Risks table) rather than retrofitting
- Cross-client propagation: sync-cursor + event-replay is the correctness mechanism (Must Have); SSE on wifi with polling fallback on cellular/undetected connections is the liveness enhancement (also Must Have, but architecturally must degrade gracefully — no code path should assume the SSE connection is present)
- Session-lifecycle notifications (open/closing-soon/closed) require web push (VAPID keys, service worker push handler) plus an in-app notification surface; design the trigger mechanism generically in `core` (event stream → trigger rule → notification payload) so overtake/milestone triggers can be added later without rework
- `packages/core` must remain framework-agnostic TypeScript with zero Next.js imports and zero domain nouns ("mango," "group," "trip," "day," "wager") per root CLAUDE.md — this spec's "Group" and "Session" concepts need generic names at the core-library API boundary (e.g. via `Skill(architecting-systems)`) before implementation
- Postgres per stack decision in CLAUDE.md; the append-only event log requirement should inform schema design (event table + derived/materialized aggregates for the leaderboard, rather than mutable counters)

**Dependencies:** Clerk account/config, Postgres instance, PWA/service-worker tooling for offline queueing and installability.

**Next step:** `Skill(architecting-systems)` to define the generic core vocabulary and module boundaries before any schema or API work starts.

### For Design (ce:design)

**Experience qualities:**
- **Fast** — the core log action must feel instant, online or offline; this is the single most important interaction in the product.
- **Obvious** — zero onboarding/instructions needed to log an item; a first-time member should understand the tap target immediately.
- **Expressive** — this is not a neutral utility. The Mango Tracker skin should lean hard into Mexico/beach/tropics identity (color, iconography, motion, copy voice) as a genuine point of differentiation, not a restrained "SaaS dashboard" treatment. Tension to name explicitly: "Fast/Obvious" pushes toward minimal UI, "Expressive" pushes toward rich visual identity — resolve by keeping the *tap target and core loop* dead simple while spending the "expressive" budget on the surrounding chrome (backgrounds, leaderboard visualization, recap screen, animations, iconography), not on adding steps to the core action.

**Reference products:** Fundraiser thermometers (goal-progress visualization), Untappd (frictionless single-item logging), Beer Olympics-style live event leaderboards. Explicitly *not* Splitwise's split-precision UX — keep shared/individual attribution to the simple binary choice defined in Scope.

**Key interactions:** Entry via invite acceptance → landing on current session with the primary tap target front and center → one-tap log with individual/shared choice → live leaderboard/report (accessible any time, not just post-session) → session-close recap moment.
