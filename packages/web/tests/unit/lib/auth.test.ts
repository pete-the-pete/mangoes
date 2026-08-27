import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role, UserRoleStore } from "core";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

// Importing auth.ts pulls in @/lib/db, which would otherwise construct a real pg Pool.
vi.mock("@/lib/db", () => ({ userRoleStore: undefined }));
// Passes the metadata straight through, standing in for the real helper's
// "here is what is left pending after my clear" contract — getCurrentUserRole
// feeds that return value to applyPendingInviteName.
vi.mock("@/lib/pendingCohortInvite", () => ({
  joinPendingCohort: vi.fn(async (input: { publicMetadata: unknown }) => input.publicMetadata),
}));
vi.mock("@/lib/pendingInviteName", () => ({ applyPendingInviteName: vi.fn() }));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { joinPendingCohort } from "@/lib/pendingCohortInvite";
import { applyPendingInviteName } from "@/lib/pendingInviteName";
import { getCurrentUserRole, requireRole } from "@/lib/auth";

function fakeStore(initial: Record<string, Role> = {}): UserRoleStore {
  const roles = new Map(Object.entries(initial));
  return {
    async getRole(id) {
      return roles.get(id);
    },
    async upsertRole(id, role) {
      roles.set(id, role);
    },
    async listRoles() {
      return [...roles.entries()].map(([clerkUserId, role]) => ({
        clerkUserId,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  };
}

function signedInAs(
  email: string,
  publicMetadata: Record<string, unknown> = {},
  name: { firstName: string | null; lastName: string | null } = {
    firstName: null,
    lastName: null,
  },
) {
  vi.mocked(auth).mockResolvedValue({ userId: "u1" } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        primaryEmailAddress: { emailAddress: email },
        publicMetadata,
        ...name,
      }),
    },
  } as never);
}

describe("requireRole", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(clerkClient).mockReset();
    vi.mocked(joinPendingCohort).mockReset();
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await requireRole(["owner"], fakeStore());

    expect(result).toEqual({ ok: false, status: 401, error: "Not signed in" });
  });

  it("returns 403 when the resolved role isn't allowed", async () => {
    signedInAs("friend@gmail.com");

    const result = await requireRole(["owner"], fakeStore({ u1: "member" }));

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Not authorized",
      role: "member",
      clerkUserId: "u1",
    });
  });

  it("returns ok: true when the resolved role is allowed", async () => {
    signedInAs("pete@gmail.com");

    const result = await requireRole(["owner", "admin"], fakeStore({ u1: "owner" }));

    expect(result).toEqual({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
  });
});

// The group half of an invitation is consumed on the same pass that resolves the
// platform role — there is no other request guaranteed to run for every user.
describe("getCurrentUserRole", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(clerkClient).mockReset();
    vi.mocked(joinPendingCohort).mockReset();
    vi.mocked(applyPendingInviteName).mockReset();
  });

  it("consumes a pending group invitation", async () => {
    signedInAs("friend@gmail.com", {
      intendedRole: "member",
      intendedCohortId: "c1",
    });

    await getCurrentUserRole(fakeStore({ u1: "member" }));

    expect(joinPendingCohort).toHaveBeenCalledWith({
      clerkUserId: "u1",
      publicMetadata: { intendedRole: "member", intendedCohortId: "c1" },
    });
  });

  // The name half of the same invitation, handed the user's current name so
  // applyPendingInviteName can decide whether it is safe to apply.
  it("consumes a pending invitation name, passing the user's current name", async () => {
    signedInAs(
      "friend@gmail.com",
      { intendedRole: "member", intendedFirstName: "Ada" },
      { firstName: null, lastName: "Lovelace" },
    );

    await getCurrentUserRole(fakeStore({ u1: "member" }));

    expect(applyPendingInviteName).toHaveBeenCalledWith({
      clerkUserId: "u1",
      firstName: null,
      lastName: "Lovelace",
      publicMetadata: { intendedRole: "member", intendedFirstName: "Ada" },
    });
  });
});

/**
 * The fast path, and the reason it can't quietly regress.
 *
 * `getCurrentUserRole` used to call `clerk.users.getUser()` on every
 * authenticated request — 16 call sites, including the guard on every logged
 * mango. These assert the absence of that call, which is the whole point and is
 * otherwise invisible: reintroducing the round trip breaks no behavior, it just
 * makes every request slower again, silently.
 *
 * The claim these read comes from the Clerk Dashboard's session-token template
 * (`{"metadata": "{{user.public_metadata}}"}`). If that is ever removed, the
 * "falls back" test below is the one that documents what happens.
 */
describe("getCurrentUserRole — the no-network fast path", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(clerkClient).mockReset();
    vi.mocked(joinPendingCohort).mockReset();
    vi.mocked(applyPendingInviteName).mockReset();
  });

  /** Signed in with a session token that carries the publicMetadata claim. */
  function signedInWithClaim(metadata: Record<string, unknown>) {
    vi.mocked(auth).mockResolvedValue({
      userId: "u1",
      sessionClaims: { metadata },
    } as never);
    // Deliberately left as a rejecting mock: any call is a failure, not a pass.
    vi.mocked(clerkClient).mockRejectedValue(
      new Error("clerkClient() must not be called on the fast path"),
    );
  }

  it("resolves a known user with no pending invite without calling Clerk", async () => {
    signedInWithClaim({});

    const result = await getCurrentUserRole(fakeStore({ u1: "member" }));

    expect(result).toEqual({ clerkUserId: "u1", role: "member" });
    expect(clerkClient).not.toHaveBeenCalled();
    // The invite consumers are equally skipped — they only have work to do when
    // the metadata says so, and the claim already told us it doesn't.
    expect(joinPendingCohort).not.toHaveBeenCalled();
    expect(applyPendingInviteName).not.toHaveBeenCalled();
  });

  it("still skips Clerk when consumed invite keys are left behind as null", async () => {
    // joinPendingCohort nulls its key rather than deleting it, so this is what
    // most real users' metadata looks like forever after their first sign-in.
    // If this regressed, the fast path would never engage for anyone invited.
    signedInWithClaim({
      intendedCohortId: null,
      intendedFirstName: null,
      intendedRole: "member",
    });

    const result = await getCurrentUserRole(fakeStore({ u1: "member" }));

    expect(result).toEqual({ clerkUserId: "u1", role: "member" });
    expect(clerkClient).not.toHaveBeenCalled();
  });

  it("falls back to Clerk when the token carries no metadata claim", async () => {
    // The session-token template isn't applied, or the token predates it. We
    // can't tell "nothing pending" from "no information", so we must not guess.
    // This is what makes the change safe to deploy before the Dashboard edit.
    signedInAs("friend@gmail.com", {});

    const result = await getCurrentUserRole(fakeStore({ u1: "member" }));

    expect(result).toEqual({ clerkUserId: "u1", role: "member" });
    expect(clerkClient).toHaveBeenCalled();
  });

  it("falls back to Clerk when the claim says an invite is still pending", async () => {
    // A stale claim can only ever cost an extra round trip, never skip work —
    // the authoritative metadata is then read from Clerk as before.
    vi.mocked(auth).mockResolvedValue({
      userId: "u1",
      sessionClaims: { metadata: { intendedCohortId: "c1" } },
    } as never);
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          primaryEmailAddress: { emailAddress: "friend@gmail.com" },
          publicMetadata: { intendedCohortId: "c1" },
          firstName: null,
          lastName: null,
        }),
      },
    } as never);

    await getCurrentUserRole(fakeStore({ u1: "member" }));

    expect(clerkClient).toHaveBeenCalled();
    expect(joinPendingCohort).toHaveBeenCalled();
  });

  it("falls back to Clerk on a user's first sight, claim or not", async () => {
    // No role row yet, so resolveRole genuinely needs the email (bootstrap
    // check) and intendedRole. The claim saying "nothing pending" is not
    // enough on its own.
    vi.mocked(auth).mockResolvedValue({
      userId: "u1",
      sessionClaims: { metadata: {} },
    } as never);
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          primaryEmailAddress: { emailAddress: "new@gmail.com" },
          publicMetadata: {},
          firstName: null,
          lastName: null,
        }),
      },
    } as never);

    const result = await getCurrentUserRole(fakeStore());

    expect(clerkClient).toHaveBeenCalled();
    expect(result).toEqual({ clerkUserId: "u1", role: "member" });
  });
});
