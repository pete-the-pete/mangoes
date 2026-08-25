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
