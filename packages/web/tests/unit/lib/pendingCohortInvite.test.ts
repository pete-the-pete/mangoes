import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ cohortStore: { addMember: vi.fn() } }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { joinPendingCohort } from "@/lib/pendingCohortInvite";

const clerkMock = { users: { updateUser: vi.fn() } };

beforeEach(() => {
  vi.mocked(cohortStore.addMember).mockReset();
  clerkMock.users.updateUser.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("joinPendingCohort", () => {
  it("joins the cohort and clears the metadata", async () => {
    await joinPendingCohort({
      clerkUserId: "u2",
      publicMetadata: { intendedRole: "member", intendedCohortId: "c1" },
    });

    expect(cohortStore.addMember).toHaveBeenCalledWith("c1", "u2", "member");
    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u2", {
      publicMetadata: { intendedRole: "member", intendedCohortId: null },
    });
  });

  // The whole reason clearing is mandatory: getCurrentUserRole runs on every
  // request, so an uncleared invitation would silently re-add a member an admin
  // had just removed.
  it("does nothing when the metadata carries no cohort id", async () => {
    await joinPendingCohort({
      clerkUserId: "u2",
      publicMetadata: { intendedRole: "member" },
    });

    expect(cohortStore.addMember).not.toHaveBeenCalled();
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("ignores a non-string cohort id", async () => {
    await joinPendingCohort({
      clerkUserId: "u2",
      publicMetadata: { intendedCohortId: 42 },
    });
    expect(cohortStore.addMember).not.toHaveBeenCalled();
  });

  // Insert first, clear second: the failure window re-adds on the next request,
  // where the reverse order would drop the membership entirely.
  it("swallows a failure to clear so sign-in still succeeds", async () => {
    clerkMock.users.updateUser.mockRejectedValue(new Error("clerk down"));
    await expect(
      joinPendingCohort({
        clerkUserId: "u2",
        publicMetadata: { intendedCohortId: "c1" },
      }),
    ).resolves.toBeUndefined();
    expect(cohortStore.addMember).toHaveBeenCalled();
  });
});
