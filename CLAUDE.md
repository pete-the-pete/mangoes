# Project: Mango Tracker (working name)

This repo contains two things, deliberately kept separate:

1. **`packages/core`** — a generic, domain-agnostic infrastructure layer (auth, users,
   admin, tracking/telemetry, monitoring, storage, types, testing/DevOps conventions).
   Written as if it will be extracted into its own package/repo later — treat that
   extraction as a real constraint, not a someday-maybe.
2. **`packages/web`** — the deployable Next.js app (Vercel), a social mango-tracking
   app built on top of `core`. There is no separate `apps/` tree — the app lives in
   `packages/` alongside `core`.

Read this file at the start of every session. It stays intentionally short — mode detailed docs
lives in `docs/`. Update the relevant doc (not this file) as decisions get made.

- Product/design specs live in `docs/specs/`, implementation plans in `docs/plans/` — not under
  `docs/superpowers/`, which is a skill-default path that doesn't match this repo's convention.

---

## 1. Architecture boundary (non-negotiable)

- `packages/web` may import from `packages/core`. **`packages/core` may never import
  from `packages/web`, and may never contain the word "mango," "group," "trip," "day"
  (as a domain concept), "wager," or any other app-specific noun.**
- If a feature seems core-ish but is actually mango-specific, it belongs in
  `packages/web` and should consume generic primitives from `core` (e.g. a generic
  time-bucketed counter/event system), not bake in the domain shape.
- Before adding anything to `core`, ask: "would a totally unrelated app want this
  exact thing?" If no, it goes in `packages/web`.
- This is the one rule every skill and agent in this repo should treat as fixed, even
  as everything in `docs/` evolves around it.

---

## 2. Tech stack

- **Language:** TypeScript everywhere, strict mode, no implicit `any`.
- **Runtime/framework:** Node.js + Next.js (App Router) for `packages/web`.
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

---

## 4. Work tracking — GitHub Issues & Projects

Repo: `pete-the-pete/mangoes`. Track work through GitHub, not just commits — the goal
is that anyone (including a future session with no memory of this one) can look at the
Project board and know exactly what's in flight, what's next, and why.

- **The Project board is #6 ("Mangoes"),** https://github.com/users/pete-the-pete/projects/6.
  This is the *only* board for this repo — **check `gh project list --owner pete-the-pete`
  before ever running `gh project create`**; a prior session (and a later one) both
  created stray duplicate boards (#7, #8) by not checking first, and both had to be
  deleted. Don't repeat that.
- **Every spec/plan becomes an Issue before implementation starts.** A doc in
  `docs/specs/` or `docs/plans/` is the detailed write-up; the Issue is the tracked,
  status-having pointer to it. Link both directions (Issue references the doc path;
  the doc can reference the Issue number once it exists).
- **Issues live on Project #6**, moved through status columns (Backlog → Ready →
  In Progress → In Review → Done) as work proceeds. Don't let issues pile up
  unassigned to it.
- **Work happens on branches + PRs linked to their Issue** (`Closes #N` in the PR
  body), not direct commits to `main` — once the board exists, a merge is what moves
  an item to Done, not a manual drag.
- **Tooling:**
  - `gh` CLI is the default for day-to-day issue/PR/project work
    (`gh issue create`, `gh pr create`, `gh project item-add`, etc.). Requires
    `gh auth login -h github.com` — check `gh auth status` first if a command 401s.
  - The GitHub MCP server (`github@claude-plugins-official` plugin, already
    installed) is available for anything `gh` handles poorly — bulk project-field
    updates, custom GraphQL queries, cross-repo views. It needs
    `GITHUB_PERSONAL_ACCESS_TOKEN` set in the environment to connect
    (`claude mcp list` shows connection status).
  - Prefer `gh` for simple CRUD; reach for the MCP server when the task needs
    structured/bulk data back, not just a fire-and-forget command.
- Before starting non-trivial work, check whether an Issue already covers it; if not,
  create one first rather than working untracked.
