import type { CohortMemberChange, CohortMemberRecord } from "./types.js";

/**
 * True when applying `change` to `targetUserId` would leave the cohort with zero
 * admins. Pure — callers read current members and decide what to do.
 *
 * Two change shapes, unlike the platform's `wouldRemoveLastOwner`: platform users
 * cannot be deleted, but cohort members can be removed, and both paths strand a
 * cohort the same way.
 */
export function wouldRemoveLastCohortAdmin(
  members: Pick<CohortMemberRecord, "clerkUserId" | "role">[],
  targetUserId: string,
  change: CohortMemberChange,
): boolean {
  const target = members.find((m) => m.clerkUserId === targetUserId);
  if (!target || target.role !== "admin") {
    return false;
  }
  if (change.type === "role" && change.role === "admin") {
    return false;
  }
  const adminCount = members.filter((m) => m.role === "admin").length;
  return adminCount <= 1;
}
