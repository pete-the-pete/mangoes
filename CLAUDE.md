# Project: Mango Tracker (working name)

This repo contains two things, deliberately kept separate:

1. **`packages/core`** — a generic, domain-agnostic infrastructure layer (auth, users,
   admin, tracking/telemetry, monitoring, storage, types, testing/DevOps conventions).
   Written as if it will be extracted into its own package/repo later — treat that
   extraction as a real constraint, not a someday-maybe.
2. **`apps/mangoes`** — a social mango-tracking app built on top of `core`.

Read this file at the start of every session. It stays intentionally short — mode detailed docs
lives in `docs/`. Update the relevant doc (not this file) as decisions get made.

---

## 1. Architecture boundary (non-negotiable)

- `apps/mangoes` may import from `packages/core`. **`packages/core` may never import
  from `apps/mangoes`, and may never contain the word "mango," "group," "trip," "day"
  (as a domain concept), "wager," or any other app-specific noun.**
- If a feature seems core-ish but is actually mango-specific, it belongs in
  `apps/mangoes` and should consume generic primitives from `core` (e.g. a generic
  time-bucketed counter/event system), not bake in the domain shape.
- Before adding anything to `core`, ask: "would a totally unrelated app want this
  exact thing?" If no, it goes in `apps/mangoes`.
- This is the one rule every skill and agent in this repo should treat as fixed, even
  as everything in `docs/` evolves around it.

---

## 2. Tech stack

- **Language:** TypeScript everywhere, strict mode, no implicit `any`.
- **Runtime/framework:** Node.js + Next.js (App Router) for `apps/mangoes`.
  `packages/core` is framework-agnostic plain TS — no Next.js imports.
- **Database:** postgres.
- **Containerization:** Docker + Docker Compose, for both local dev and self-hosted
  deploy.
- **Assumption (revisit as needed):** npm workspaces to start, not Turborepo/pnpm —
  simplest option for a single-box self-hosted setup. Upgrade path is Turborepo if
  build times or task orchestration get painful.

---

## 3. Agents & skills — be proactive

Lean hard on agents and skills rather than repeating manual work. Default posture:
**propose before being asked.**

- **When to propose a skill:** if the same multi-step workflow shows up twice (e.g.
  "add a new tracked metric to core," "scaffold a new admin-only API route"), stop
  and propose a skill in `.claude/skills/` rather than repeating it a third time.
- **When to propose a subagent:** for recurring, scoped jobs that benefit from
  isolated context — e.g. a `core-boundary-checker` agent that flags domain leakage
  into `packages/core`, a `design-iterator` agent for the mango app's UI work.
  Define these in `.claude/agents/`.
- Don't wait for permission to *suggest* one — surface the proposal with a short
  rationale, then wait for confirmation before writing/registering it.
- After finishing a chunk of work, ask: "did I just do something I'll likely do
  again in this repo?" If yes, that's a skill/agent candidate.
- Actively look for tools/connectors that would help (GitHub PR workflows, monitoring
  dashboards, etc.) and flag them — don't assume the current toolset is fixed.
- Concern-specific docs (see index above) are meant to be **maintained by their
  owning skill**, not hand-edited ad hoc once that skill exists — e.g. once a PM
  skill exists, product/domain decisions should flow through it and land in
  `docs/domain-model.md`.
