import { clerkClient } from "@clerk/nextjs/server";
import type { CohortMemberRecord, CohortStore } from "core";

/** Clerk profile fields available to decorate a membership row. Includes email —
 * callers decide which fields their view is allowed to expose. Never spread this
 * type directly into a member-facing view; pick fields explicitly. */
export interface ClerkMemberIdentity {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface DecoratedCohortMember {
  member: CohortMemberRecord;
  identity: ClerkMemberIdentity;
}

/**
 * Fetches group membership rows and decorates them with Clerk identity data.
 * Membership rows are the source of truth for who is in the group; Clerk only
 * decorates them. A row with no Clerk user still shows, still counts.
 *
 * This lives in its own module, separate from both the admin and member
 * roster projections, so that neither surface imports from the other's file
 * to get here — an admin-named module is exactly what a member-facing caller
 * should never need to reach into.
 */
export async function decorateCohortMembers(
  groupId: string,
  store: CohortStore,
): Promise<DecoratedCohortMember[]> {
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

  return members.map((member) => {
    const user = byId.get(member.clerkUserId);
    return {
      member,
      identity: {
        name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null : null,
        email: user?.primaryEmailAddress?.emailAddress ?? null,
        avatarUrl: user?.imageUrl ?? null,
      },
    };
  });
}
