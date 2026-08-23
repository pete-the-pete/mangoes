import type { UserRoleStore } from "./userRoleStore.js";
import type { Role } from "./types.js";

export interface ResolveRoleInput {
  clerkUserId: string;
  email: string;
  bootstrapEmails: string[];
  // Explicitly `| undefined`: exactOptionalPropertyTypes is on, and callers read
  // this off invitation metadata that may not carry it.
  intendedRoleFromInvitation?: Role | undefined;
}

/**
 * Resolves the role for a signed-in user, persisting it on first sight:
 * an existing row wins, then a bootstrap email match (owner), then the role
 * their invitation intended, then `member`.
 */
export async function resolveRole(
  store: UserRoleStore,
  input: ResolveRoleInput,
): Promise<Role> {
  const existing = await store.getRole(input.clerkUserId);
  if (existing) {
    return existing;
  }

  const normalizedEmail = input.email.toLowerCase();
  const isBootstrap = input.bootstrapEmails
    .map((email) => email.toLowerCase())
    .includes(normalizedEmail);

  const role: Role = isBootstrap
    ? "owner"
    : (input.intendedRoleFromInvitation ?? "member");

  await store.upsertRole(input.clerkUserId, role);
  return role;
}
