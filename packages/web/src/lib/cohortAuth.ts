import type { CohortRole, CohortStore, Role } from "core";
import { requireRole } from "./auth";
import { cohortStore } from "./db";

export interface CohortGuardResult {
  ok: boolean;
  status: number;
  error?: string | undefined;
  clerkUserId?: string | undefined;
  platformRole?: Role | undefined;
  cohortRole?: CohortRole | undefined;
}

/**
 * The group-scoped half of authorization, in two steps:
 *
 *   1. Platform gate — everything under /admin/api/* is platform-admin territory.
 *   2. Group role — with the platform owner passing unconditionally.
 *
 * Like requireRole, this is called inside each route handler. Route handlers do
 * not run layouts, so app/admin/layout.tsx protects pages only.
 */
export async function requireCohortRole(
  cohortId: string,
  allowed: CohortRole[],
  store: CohortStore = cohortStore,
): Promise<CohortGuardResult> {
  const platform = await requireRole(["owner", "admin"]);
  if (!platform.ok || !platform.clerkUserId || !platform.role) {
    return { ok: false, status: platform.status, error: platform.error };
  }

  const clerkUserId = platform.clerkUserId;
  const cohortRole = await store.getMemberRole(cohortId, clerkUserId);

  if (platform.role === "owner") {
    return {
      ok: true,
      status: 200,
      clerkUserId,
      platformRole: "owner",
      cohortRole,
    };
  }

  if (!cohortRole || !allowed.includes(cohortRole)) {
    return { ok: false, status: 403, error: "Not authorized" };
  }

  return {
    ok: true,
    status: 200,
    clerkUserId,
    platformRole: platform.role,
    cohortRole,
  };
}

/**
 * "May this person open the group's admin screens?" — the same two steps
 * `requireCohortRole` applies, as a plain boolean for pages that need to decide
 * whether to *offer* a link rather than to authorize a request.
 *
 * The platform gate is not a formality here. Everything under `/admin` is
 * platform-admin territory (`app/admin/layout.tsx`), so a cohort admin whose
 * platform role is still `member` would be bounced by that layout — offering
 * them the link would be offering a door that doesn't open.
 *
 * Never use this in place of a guard: it decides what to render, and the
 * admin pages and routes it points at re-check for themselves.
 */
export async function canManageCohort(
  cohortId: string,
  clerkUserId: string,
  /** Absent means no platform role was resolved — never manage-capable. Taking
   *  `undefined` here rather than making each caller guard is deliberate: the
   *  guards that supply it type it optional, and a caller's `role ? … : false`
   *  ternary silently hides the link instead of failing loudly if that ever
   *  stops being populated. */
  platformRole: Role | undefined,
  store: CohortStore = cohortStore,
): Promise<boolean> {
  if (platformRole === "owner") {
    return true;
  }
  if (platformRole !== "admin") {
    return false;
  }
  return (await store.getMemberRole(cohortId, clerkUserId)) === "admin";
}
