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

// Clerk's maximum page size. Fewer, larger pages is the only lever available.
const INVITE_PAGE_SIZE = 500;

// A ceiling on how far we will page before giving up, so one runaway instance
// can't turn a group page into an unbounded sequence of Clerk calls. 10k pending
// invitations platform-wide is far past the point where this UI is the problem.
const MAX_INVITE_PAGES = 20;

/**
 * The pending invitations that name this group.
 *
 * Clerk has no way to filter invitations by `publicMetadata`, so the only
 * correct implementation is to page the instance-wide pending list and match
 * client-side. That is genuinely O(all pending invitations) — if this ever
 * becomes hot, the fix is to mirror invitations into Postgres at creation time,
 * not to micro-optimize here.
 *
 * It previously made a single unpaginated call, which was not merely slower but
 * wrong: Clerk's default page size is 10, so once the instance had more than ten
 * pending invitations, a group's own invites started disappearing from this list
 * depending on how recently they were created.
 */
export async function listPendingGroupInvites(
  groupId: string,
): Promise<PendingInviteView[]> {
  const clerk = await clerkClient();
  const matches: PendingInviteView[] = [];

  for (let page = 0; page < MAX_INVITE_PAGES; page += 1) {
    const { data, totalCount } = await clerk.invitations.getInvitationList({
      status: "pending",
      limit: INVITE_PAGE_SIZE,
      offset: page * INVITE_PAGE_SIZE,
    });

    for (const invitation of data) {
      if (invitation.publicMetadata?.["intendedCohortId"] === groupId) {
        matches.push({ id: invitation.id, email: invitation.emailAddress });
      }
    }

    // Stop on a short page as well as on the count: `totalCount` is computed
    // separately from the page and can disagree with it if an invitation is
    // accepted mid-walk, and a short page is the unambiguous end signal.
    if (data.length < INVITE_PAGE_SIZE || (page + 1) * INVITE_PAGE_SIZE >= totalCount) {
      break;
    }
  }

  return matches;
}
