import type { Role } from "core";
import { getCurrentUserRole } from "./auth";
import { canManageCohort } from "./cohortAuth";
import { cycleStore } from "./db";

export interface CycleGuardResult {
  ok: boolean;
  status: number;
  error?: string | undefined;
  clerkUserId?: string | undefined;
  platformRole?: Role | undefined;
  /** True when access came from platform owner, not participation. */
  isSuperuser?: boolean | undefined;
}

/**
 * Participation-only authorization for the member API. Unlike requireRole and
 * requireCohortRole, platform role grants nothing here — a platform admin who
 * is not in the session and does not administer its group gets the same 403 as
 * anyone else.
 *
 * Two escape hatches, both read-only by convention and both flagged
 * `isSuperuser`: the platform owner (as v0.1 and v0.2 established), and an
 * admin of the session's own group. The second is what lets a group admin open
 * the member session screen at all — the screen everyone else in the group
 * uses — instead of only ever seeing the admin one. It leaks nothing: that
 * admin can already read every entry in this session on `/admin`.
 *
 * Participation is now checked *first*, before either hatch. It used to be
 * checked last, so an owner who genuinely took part in a session was still
 * reported as `isSuperuser: true` — the flag meant "is the platform owner,"
 * not "got in without participating," which is what every caller reads it as.
 *
 * Called inside each route handler. Route handlers do not run layouts.
 */
export async function requireCycleParticipant(cycleId: string): Promise<CycleGuardResult> {
  const current = await getCurrentUserRole();
  if (!current) {
    return { ok: false, status: 401, error: "Not signed in" };
  }

  if (await cycleStore.isCycleParticipant(cycleId, current.clerkUserId)) {
    return {
      ok: true,
      status: 200,
      clerkUserId: current.clerkUserId,
      platformRole: current.role,
      isSuperuser: false,
    };
  }

  if (current.role === "owner") {
    return {
      ok: true,
      status: 200,
      clerkUserId: current.clerkUserId,
      platformRole: "owner",
      isSuperuser: true,
    };
  }

  // Reading the cycle to find its group is the only way to ask "do you
  // administer this?", and it happens only on the path that was already
  // heading for a 403 — never on the participant path above.
  const cycle = await cycleStore.getCycle(cycleId);
  if (
    cycle &&
    (await canManageCohort(cycle.cohortId, current.clerkUserId, current.role))
  ) {
    return {
      ok: true,
      status: 200,
      clerkUserId: current.clerkUserId,
      platformRole: current.role,
      isSuperuser: true,
    };
  }

  // Deliberately identical whether the cycle is missing or the caller was
  // removed — otherwise this endpoint enumerates session ids. The lookup above
  // must not change that: a missing cycle and a cycle you don't administer
  // both fall through to exactly this response.
  return { ok: false, status: 403, error: "Not authorized" };
}
