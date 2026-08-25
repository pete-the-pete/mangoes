import { clerkClient } from "@clerk/nextjs/server";
import type { CohortRole, CohortStore } from "core";
import { cohortStore } from "./db";

export interface GroupMemberView {
  clerkUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: CohortRole;
}

export interface PendingInviteView {
  id: string;
  email: string;
}

export async function listGroupMembersForAdmin(
  groupId: string,
  store: CohortStore = cohortStore,
): Promise<GroupMemberView[]> {
  const members = await store.listMembers(groupId);
  if (members.length === 0) {
    return [];
  }

  const clerk = await clerkClient();
  const { data: users } = await clerk.users.getUserList({
    userId: members.map((m) => m.clerkUserId),
    limit: members.length,
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  // Membership rows are the source of truth for who is in the group; Clerk only
  // decorates them. A row with no Clerk user still shows, still counts.
  return members.map((member) => {
    const user = byId.get(member.clerkUserId);
    return {
      clerkUserId: member.clerkUserId,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null : null,
      avatarUrl: user?.imageUrl ?? null,
      role: member.role,
    };
  });
}

export async function listPendingGroupInvites(
  groupId: string,
): Promise<PendingInviteView[]> {
  const clerk = await clerkClient();
  const { data } = await clerk.invitations.getInvitationList({ status: "pending" });
  return data
    .filter((invitation) => invitation.publicMetadata?.["intendedCohortId"] === groupId)
    .map((invitation) => ({ id: invitation.id, email: invitation.emailAddress }));
}
