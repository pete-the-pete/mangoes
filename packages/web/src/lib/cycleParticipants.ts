import { clerkClient } from "@clerk/nextjs/server";
import type { CycleDetail } from "core";

export interface CycleParticipantView {
  clerkUserId: string;
  name: string;
  imageUrl: string;
}

/**
 * Joins a cycle's participant ids against Clerk for display — name/avatar,
 * server-side, the way `/api/sessions/[sessionId]/snapshot` already does it
 * for the sync client's cold-open response. Factored out here so the
 * session page's server-rendered shell (this milestone's Tasks 14/15) can
 * do the same join without duplicating the Clerk-specific bits: the guard
 * against an empty `userId` filter (Clerk treats `[]` as "no filter", not
 * "match none"), and re-deriving the returned order from `cycle.participantIds`
 * since Clerk's `getUserList` doesn't document a stable response order.
 */
export async function listCycleParticipants(cycle: CycleDetail): Promise<CycleParticipantView[]> {
  if (cycle.participantIds.length === 0) {
    return [];
  }

  const clerk = await clerkClient();
  const users = await clerk.users.getUserList({ userId: cycle.participantIds, limit: 100 });
  const byClerkId = new Map(users.data.map((u) => [u.id, u]));

  return cycle.participantIds
    .map((id) => byClerkId.get(id))
    .filter((u): u is NonNullable<typeof u> => u !== undefined)
    .map((u) => ({
      clerkUserId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.primaryEmailAddress?.emailAddress || u.id,
      imageUrl: u.imageUrl,
    }));
}
