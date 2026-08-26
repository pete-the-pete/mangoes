import { describe, it, expect, vi, beforeEach } from "vitest";

// Deliberately mocks only Clerk and the stores — joinPendingCohort and
// applyPendingInviteName both run for real. auth.test.ts mocks the pair, so the
// composition between them has no coverage there, and the composition is where
// the interesting failure lives: publicMetadata is replaced wholesale on every
// update, so two consumers writing from one snapshot undo each other.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), clerkClient: vi.fn() }));
vi.mock("@/lib/db", () => ({
  userRoleStore: {
    getRole: vi.fn().mockResolvedValue("member"),
    upsertRole: vi.fn(),
    listRoles: vi.fn().mockResolvedValue([]),
  },
  cohortStore: { addMember: vi.fn() },
}));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { getCurrentUserRole } from "@/lib/auth";

const updateUser = vi.fn();

function signedInWith(publicMetadata: Record<string, unknown>) {
  vi.mocked(auth).mockResolvedValue({ userId: "u1" } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        primaryEmailAddress: { emailAddress: "friend@gmail.com" },
        firstName: null,
        lastName: null,
        publicMetadata,
      }),
      updateUser,
    },
  } as never);
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(clerkClient).mockReset();
  vi.mocked(cohortStore.addMember).mockReset();
  updateUser.mockReset();
  updateUser.mockResolvedValue({});
});

describe("consuming an invitation that carries both a group and a name", () => {
  it("leaves every pending key cleared, not just the last one written", async () => {
    signedInWith({
      intendedRole: "member",
      intendedCohortId: "c1",
      intendedFirstName: "Ada",
      intendedLastName: "Lovelace",
    });

    await getCurrentUserRole();

    expect(cohortStore.addMember).toHaveBeenCalledWith("c1", "u1", "member");

    // The regression this file exists for: the name write starting from the
    // pre-clear snapshot would put intendedCohortId back, and the next request
    // would re-add a member an admin had just removed — forever.
    const last = updateUser.mock.calls.at(-1)![1];
    expect(last.publicMetadata).toEqual({
      intendedRole: "member",
      intendedCohortId: null,
      intendedFirstName: null,
      intendedLastName: null,
    });
    expect(last.firstName).toBe("Ada");
    expect(last.lastName).toBe("Lovelace");
  });

  // If the group clear never landed, the cohort id is genuinely still remote,
  // so the name write must carry it rather than pretend it is gone.
  it("keeps the group id pending when its own clear failed", async () => {
    signedInWith({
      intendedCohortId: "c1",
      intendedFirstName: "Ada",
    });
    updateUser
      .mockRejectedValueOnce(new Error("clerk down"))
      .mockResolvedValue({});

    await getCurrentUserRole();

    const last = updateUser.mock.calls.at(-1)![1];
    expect(last.publicMetadata).toEqual({
      intendedCohortId: "c1",
      intendedFirstName: null,
      intendedLastName: null,
    });
  });
});
