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
 *
 * Returns the metadata as it now stands remotely, which the caller must hand to
 * the next consumer. `updateUser({ publicMetadata })` replaces the whole object
 * rather than merging, so a second consumer writing from the pre-clear snapshot
 * would put `intendedCohortId` straight back and re-add the member forever.
 */
export async function joinPendingCohort(
  input: PendingCohortInviteInput,
  store: CohortStore = cohortStore,
): Promise<Record<string, unknown>> {
  const cohortId = input.publicMetadata["intendedCohortId"];
  if (typeof cohortId !== "string" || cohortId.length === 0) {
    return input.publicMetadata;
  }

  await store.addMember(cohortId, input.clerkUserId, "member");

  const cleared = { ...input.publicMetadata, intendedCohortId: null };
  try {
    const clerk = await clerkClient();
    await clerk.users.updateUser(input.clerkUserId, {
      publicMetadata: cleared,
    });
    return cleared;
  } catch {
    // Membership already landed. A failed clear costs one redundant re-add on
    // the next request; failing the whole sign-in over it costs the user access.
    // The pre-clear snapshot is what's still remote, so that is what's returned.
    return input.publicMetadata;
  }
}
