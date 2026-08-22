# Milestone Execution Workflow — Design Plan

**Status:** design/requirements captured, not yet implemented. Revisit when ready to build.

**Goal:** support a single instruction like *"execute all open tasks in milestone X until
you're blocked or the milestone is done, work independent tickets in parallel, stack
dependent tickets on chained branches, and keep things mergeable so I can keep running
the server and playing with what's landed."*

This is the write/execute counterpart to the [[pm-status]] agent
(`.claude/agents/pm-status.md`), which is read-only. This workflow is the thing that
actually writes code, opens branches/PRs, and moves issues through their lifecycle.

---

## Decisions already made (don't re-litigate these)

- **Issues are the source of truth** for work items; **Milestones** group issues toward
  a release, resolved by title match at request time — never a hardcoded milestone
  number, since this repo will have several milestones over time. **Project #6**
  ("Mangoes") is a view/board over the same issues, not a separate data source — see
  `CLAUDE.md` §4.
- **Dependencies between issues are recorded in the issue body** as `Blocked by #N` /
  `Depends on #N` — plain text, not a GitHub-native field (Issues don't have one that's
  easily queryable). Any orchestration logic parses this from the body.
- **Work happens on branches + PRs linked to their issue** (`Closes #N`), not direct
  commits to `main` (`CLAUDE.md` §4).
- **`pm-status` is read-only** and is the tool for "where are we" questions — this
  workflow is a separate, heavier capability for actually executing work, and should
  probably call `pm-status`-equivalent logic internally to resolve scope/dependencies
  rather than duplicating that parsing.

---

## Open design questions (resolve before/while implementing)

1. **Orchestration mechanism.** This needs real parallelism (independent issues built
   concurrently) and real sequencing (dependent issues stacked in order) with
   long-running, potentially interrupted work. Leading candidate: the `Workflow` tool
   (`pipeline()`/`parallel()`/`agent()` with `isolation: 'worktree'` for agents that
   mutate files concurrently) rather than one subagent doing everything serially.
   Needs explicit opt-in from the user per-run (per this environment's Workflow-usage
   rules) — worth deciding whether that's a standing "yes" for this specific named
   workflow or asked each time.

2. **Branch-stacking convention.** Not yet defined:
   - Branch naming (e.g. `issue-<N>-<slug>`)?
   - For a dependent chain (Task 5 depends on Task 2), does Task 5's branch fork from
     Task 2's branch (before Task 2 merges) or wait for Task 2 to merge to `main`
     first? Forking early enables more parallelism but means Task 5 needs rebasing if
     Task 2's branch changes after review.
   - PR base branch for a stacked PR — points at the parent branch, not `main`, until
     that parent merges, then gets retargeted (manually or via `gh pr edit --base`).
   - Merge order — must be bottom-up (earliest dependency first); how does the
     workflow avoid a later branch merging before its dependency.

3. **"Keep it runnable" requirement.** The user wants to `git pull` and run the dev
   server against landed work at any point mid-milestone. Implications:
   - Each merged PR must leave `main` in a working state (builds, typechecks, doesn't
     break the dev server) — not just "tests pass in isolation."
   - Feature flags or incremental UI wiring may be needed if a task's UI isn't
     functional until a later dependent task lands (e.g. Task 10's `/admin` UI depends
     on Tasks 5–9's API routes existing first) — or the stacking order should just put
     UI-visible tasks last.

4. **Blocked-detection and reporting.** What counts as "blocked" vs. "the agent should
   just figure it out":
   - Missing external prerequisite (see Tickets E1–E3 pattern in the super-admin
     plan — Clerk dashboard, hosted Postgres, Vercel env vars — these are explicitly
     "not agent-executable").
   - Ambiguous acceptance criteria the agent can't resolve from the spec/plan doc.
   - A failing test/build it can't fix after reasonable attempts.
   - How blocked issues get surfaced: a comment on the issue, a status field change,
     and/or a summary back to the user at the end of the run — probably all three.

5. **Status sync-back.** As work proceeds, does the workflow update:
   - The issue itself (comments, closing on merge)?
   - The Project board Status field (Backlog → In Progress → In Review → Done)?
   Decide whether this happens live (as each step completes) or in a batch at the end
   of the run — live is more useful for the "keep playing around" use case since the
   user can watch the board.

6. **Idempotency / resumability.** If the user re-issues the same "execute milestone X"
   instruction mid-run (interrupted session, or picking back up later), the workflow
   needs to detect what's already done/in-progress (via existing branches/PRs/issue
   state) rather than restarting or duplicating work.

7. **Verification gate before opening a PR.** Should align with this environment's
   `verification-before-completion` practice — build/typecheck/test must actually pass
   (with real command output, not assumed) before a task's branch is considered done
   and its dependents are unblocked.

---

## Non-goals for now

- Not building auto-merge — PRs still need human review/merge (at least initially).
- Not handling cross-repo milestones — single-repo (`mangoes`) only.
- Not solving CI integration in this pass — assume local verification is sufficient
  until CI exists.

---

## Next step when resumed

Work through the open questions above (probably question 1 and 2 first, since they
shape everything else), then write this out as a proper task-by-task implementation
plan in the usual format (see `docs/plans/2026-08-21-super-admin-ui.md` for the
convention), likely producing either a saved `Workflow` script or a new skill under
`.claude/skills/`.
