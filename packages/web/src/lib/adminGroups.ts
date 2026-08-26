import { clerkClient } from "@clerk/nextjs/server";
import type { CohortRole, CohortStore } from "core";
import { decorateCohortMembers } from "./cohortMemberIdentity";
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
  const rows = await decorateCohortMembers(groupId, store);
  return rows.map(({ member, identity }) => ({
    clerkUserId: member.clerkUserId,
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    role: member.role,
  }));
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
