import type { Role } from "core";
import { getCurrentUserRole } from "./auth";
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
 * requireCohortRole, platform role grants nothing here — a platform admin who is
 * not in the session gets the same 403 as anyone else. Platform owner is the one
 * exception, matching the superuser escape hatch v0.1 and v0.2 established.
 *
 * Called inside each route handler. Route handlers do not run layouts.
 */
export async function requireCycleParticipant(cycleId: string): Promise<CycleGuardResult> {
  const current = await getCurrentUserRole();
  if (!current) {
    return { ok: false, status: 401, error: "Not signed in" };
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

  const participates = await cycleStore.isCycleParticipant(cycleId, current.clerkUserId);
  if (!participates) {
    // Deliberately identical whether the cycle is missing or the caller was
    // removed — otherwise this endpoint enumerates session ids.
    return { ok: false, status: 403, error: "Not authorized" };
  }

  return {
    ok: true,
    status: 200,
    clerkUserId: current.clerkUserId,
    platformRole: current.role,
    isSuperuser: false,
  };
}
