import type { CohortRole, CohortStore } from "core";
import { decorateCohortMembers } from "./cohortMemberIdentity";
import { cohortStore } from "./db";
import { UNNAMED_MEMBER } from "./memberDisplayName";

/** A group member as any peer is allowed to see them. No email field exists on
 * this type at all — that's deliberate: v0.2's rule is that email is
 * admin-only, and a field that isn't here can't leak through a stray `??`. */
export interface GroupRosterEntry {
  clerkUserId: string;
  displayName: string;
  avatarUrl: string | null;
  role: CohortRole;
}

/**
 * Member-facing roster for a group. Shares Clerk decoration with the admin
 * roster (`decorateCohortMembers`) but never reads or forwards email — a
 * peer with no first/last name set falls back to a generic, non-identifying
 * label rather than their email or any other identity-adjacent value.
 */
export async function listGroupRosterForMember(
  groupId: string,
  store: CohortStore = cohortStore,
): Promise<GroupRosterEntry[]> {
  const rows = await decorateCohortMembers(groupId, store);
  return rows.map(({ member, identity }) => ({
    clerkUserId: member.clerkUserId,
    displayName: identity.name ?? UNNAMED_MEMBER,
    avatarUrl: identity.avatarUrl,
    role: member.role,
  }));
}
