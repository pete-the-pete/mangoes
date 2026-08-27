/**
 * Whether a user's `publicMetadata` still carries invitation state that
 * `getCurrentUserRole` has to consume.
 *
 * This is the gate on the zero-network fast path in `auth.ts`: when the session
 * token says nothing is pending and the user already has a `user_roles` row,
 * there is no reason to ask Clerk anything. Kept as a pure function in its own
 * module because the test setup is node-env with no DOM — pure functions are the
 * only surface this repo can unit-test (same reason `pickLayout` and
 * `pickTapToast` live where they do).
 *
 * `intendedRole` is deliberately NOT checked here, unlike the three keys below.
 * Nothing ever clears it — `resolveRole` reads it without consuming it — so
 * including it would strand most invited users on the slow path forever and
 * defeat the whole optimization. It is safe to omit because `resolveRole` only
 * consults it when there is no `user_roles` row, and the fast path already
 * requires one. If anything is ever added that re-resolves role for an existing
 * user, that assumption breaks and this must be revisited.
 */
export function hasPendingInvite(metadata: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(metadata["intendedCohortId"]) ||
    isNonEmptyString(metadata["intendedFirstName"]) ||
    isNonEmptyString(metadata["intendedLastName"])
  );
}

// Mirrors what the consumers actually treat as present: `joinPendingCohort`
// requires a non-empty string, and `pendingName` trims before deciding. A key
// left behind as `null` by a previous clear must not count as pending.
function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
