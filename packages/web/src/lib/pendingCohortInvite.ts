import { clerkClient } from "@clerk/nextjs/server";
import type { CohortStore } from "core";
import { cohortStore } from "./db";

export interface PendingCohortInviteInput {
  clerkUserId: string;
  publicMetadata: Record<string, unknown>;
}

/**
 * Joins a user to the group their invitation named, then consumes the metadata.
 *
 * Clearing is not bookkeeping — it is the whole mechanism. This runs on every
 * authenticated request via getCurrentUserRole, so an invitation left in place
 * would re-add a member the moment after an admin removed them. resolveRole
 * gets idempotence for free ("an existing row wins"); this does not.
 */
export async function joinPendingCohort(
  input: PendingCohortInviteInput,
  store: CohortStore = cohortStore,
): Promise<void> {
  const cohortId = input.publicMetadata["intendedCohortId"];
  if (typeof cohortId !== "string" || cohortId.length === 0) {
    return;
  }

  await store.addMember(cohortId, input.clerkUserId, "member");

  try {
    const clerk = await clerkClient();
    await clerk.users.updateUser(input.clerkUserId, {
      publicMetadata: { ...input.publicMetadata, intendedCohortId: null },
    });
  } catch {
    // Membership already landed. A failed clear costs one redundant re-add on
    // the next request; failing the whole sign-in over it costs the user access.
  }
}
