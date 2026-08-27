import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { resolveRole, type Role, type UserRoleStore } from "core";
import { userRoleStore } from "./db";
import { hasPendingInvite } from "./hasPendingInvite";
import { joinPendingCohort } from "./pendingCohortInvite";
import { applyPendingInviteName } from "./pendingInviteName";

// One bootstrap admin, not a list. `core`'s resolveRole keeps a general
// `bootstrapEmails: string[]` interface; the app is what decides there is
// exactly one, so core stays domain-agnostic.
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL?.trim() ?? "";
const BOOTSTRAP_EMAILS = SUPER_ADMIN_EMAIL ? [SUPER_ADMIN_EMAIL] : [];

/**
 * The signed-in user's id and platform role.
 *
 * Wrapped in React's `cache()` so it is computed once per request no matter how
 * many times it is called. That matters because `app/admin/layout.tsx` calls it
 * and then so does every admin page underneath — before this, that was two
 * identical Clerk round trips for one render.
 *
 * The `store` parameter is part of the cache key. Every real caller uses the
 * default; tests pass their own and get their own entry, which is what you want.
 */
export const getCurrentUserRole = cache(async function getCurrentUserRole(
  store: UserRoleStore = userRoleStore,
): Promise<{ clerkUserId: string; role: Role } | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return null;
  }

  // The fast path, and the reason this function stopped being the app's biggest
  // latency cost. `auth()` above resolves the user from the signed session
  // cookie with no network call; `getRole` is one indexed primary-key lookup.
  // Together they answer the question for every request after a user's first,
  // where previously every request paid a Clerk Backend API round trip — 16 call
  // sites, including `cycleAuth.ts`, which guards every logged mango.
  //
  // Gated on the session token carrying `metadata` (see src/types/clerk.d.ts).
  // If the claim is absent the token predates the session-token template change,
  // or the template was never applied — either way we cannot tell "no pending
  // invite" from "no information", so we fall through to the authoritative path
  // below. That makes this safe to deploy before the Dashboard change: it stays
  // correct, it just isn't faster yet.
  const claimedMetadata = sessionClaims?.metadata;
  if (claimedMetadata !== undefined && !hasPendingInvite(claimedMetadata)) {
    const existing = await store.getRole(userId);
    if (existing) {
      return { clerkUserId: userId, role: existing };
    }
  }

  // Slow path: first sight of this user, or the token says an invitation is
  // still waiting to be consumed. Read the authoritative metadata from Clerk.
  //
  // A stale token claim can only ever send us here unnecessarily — it can never
  // skip work, because the fast path above requires the claim to say nothing is
  // pending AND a role row to already exist. So one extra round trip is the
  // worst case; a wrong write is not reachable.
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

  const publicMetadata = (user.publicMetadata ?? {}) as Record<string, unknown>;

  // Chained, not two independent writes off one snapshot: publicMetadata is
  // replaced wholesale on every update, so the second consumer has to start
  // from what the first actually left behind.
  const remaining = await joinPendingCohort({
    clerkUserId: userId,
    publicMetadata,
  });

  // Same pass, same reason as the group half above: this is the only request
  // guaranteed to run for every user, so it is where an invitation's name gets
  // applied. `user` is already in hand, so the "do they have a name already?"
  // check costs no extra Clerk call.
  await applyPendingInviteName({
    clerkUserId: userId,
    firstName: user.firstName,
    lastName: user.lastName,
    publicMetadata: remaining,
  });

  return { clerkUserId: userId, role };
});

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
