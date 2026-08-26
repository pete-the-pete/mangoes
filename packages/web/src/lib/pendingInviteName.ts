import { clerkClient } from "@clerk/nextjs/server";

export interface PendingInviteNameInput {
  clerkUserId: string;
  /** The user's current Clerk name — what decides whether the invite's applies. */
  firstName: string | null;
  lastName: string | null;
  publicMetadata: Record<string, unknown>;
}

function pendingName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Applies the name an admin typed on the invitation, then consumes it.
 *
 * `clerk.invitations.createInvitation` takes no name fields, so the invite
 * routes stash them in `publicMetadata` next to `intendedRole`; this is where
 * they land on the user. Mirrors joinPendingCohort, and runs beside it in
 * getCurrentUserRole.
 *
 * Apply-if-empty, never overwrite: if the invitee typed their own name during
 * Clerk sign-up, that is the authoritative one and the admin's guess must not
 * clobber it. The metadata is consumed either way — left in place it would
 * re-apply the moment the user cleared their own name.
 */
export async function applyPendingInviteName(
  input: PendingInviteNameInput,
): Promise<void> {
  const firstName = pendingName(input.publicMetadata["intendedFirstName"]);
  const lastName = pendingName(input.publicMetadata["intendedLastName"]);
  if (!firstName && !lastName) {
    return;
  }

  const alreadyNamed = Boolean(input.firstName || input.lastName);
  const update: {
    firstName?: string;
    lastName?: string;
    publicMetadata: Record<string, unknown>;
  } = {
    publicMetadata: {
      ...input.publicMetadata,
      intendedFirstName: null,
      intendedLastName: null,
    },
  };
  if (!alreadyNamed) {
    if (firstName) {
      update.firstName = firstName;
    }
    if (lastName) {
      update.lastName = lastName;
    }
  }

  try {
    const clerk = await clerkClient();
    await clerk.users.updateUser(input.clerkUserId, update);
  } catch {
    // Nothing has been consumed yet, so the next authenticated request retries
    // the whole thing. Failing sign-in over a display name would be the worse
    // trade by a wide margin.
  }
}
