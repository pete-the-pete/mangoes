import { auth, clerkClient } from "@clerk/nextjs/server";
import { resolveRole, type Role, type UserRoleStore } from "core";
import { userRoleStore } from "./db";

// One bootstrap admin, not a list. `core`'s resolveRole keeps a general
// `bootstrapEmails: string[]` interface; the app is what decides there is
// exactly one, so core stays domain-agnostic.
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL?.trim() ?? "";
const BOOTSTRAP_EMAILS = SUPER_ADMIN_EMAIL ? [SUPER_ADMIN_EMAIL] : [];

export async function getCurrentUserRole(
  store: UserRoleStore = userRoleStore,
): Promise<{ clerkUserId: string; role: Role } | null> {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const intendedRoleFromInvitation = user.publicMetadata?.intendedRole as
    | Role
    | undefined;

  const role = await resolveRole(store, {
    clerkUserId: userId,
    email,
    bootstrapEmails: BOOTSTRAP_EMAILS,
    intendedRoleFromInvitation,
  });

  return { clerkUserId: userId, role };
}

export interface RoleGuardResult {
  ok: boolean;
  status: number;
  error?: string;
  role?: Role;
  clerkUserId?: string;
}

/**
 * The only authorization gate for `/admin/api/*` — route handlers don't run
 * layouts, so `app/admin/layout.tsx` covers none of them. Every handler added in
 * Tasks 7-9 must call this itself.
 */
export async function requireRole(
  allowed: Role[],
  store: UserRoleStore = userRoleStore,
): Promise<RoleGuardResult> {
  const current = await getCurrentUserRole(store);
  if (!current) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  if (!allowed.includes(current.role)) {
    return {
      ok: false,
      status: 403,
      error: "Not authorized",
      role: current.role,
      clerkUserId: current.clerkUserId,
    };
  }
  return {
    ok: true,
    status: 200,
    role: current.role,
    clerkUserId: current.clerkUserId,
  };
}
