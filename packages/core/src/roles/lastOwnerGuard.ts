import type { Role, UserRoleRecord } from "./types.js";

/**
 * True when changing `targetUserId` to `newRole` would leave the platform with
 * zero owners. Pure — callers read the current roles and decide what to do.
 */
export function wouldRemoveLastOwner(
  currentRoles: Pick<UserRoleRecord, "clerkUserId" | "role">[],
  targetUserId: string,
  newRole: Role,
): boolean {
  const target = currentRoles.find((r) => r.clerkUserId === targetUserId);
  if (!target || target.role !== "owner" || newRole === "owner") {
    return false;
  }
  const ownerCount = currentRoles.filter((r) => r.role === "owner").length;
  return ownerCount <= 1;
}
