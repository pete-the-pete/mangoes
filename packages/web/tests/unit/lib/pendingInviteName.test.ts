import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { applyPendingInviteName } from "@/lib/pendingInviteName";

const clerkMock = { users: { updateUser: vi.fn() } };

beforeEach(() => {
  clerkMock.users.updateUser.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("applyPendingInviteName", () => {
  it("applies the invited name to a user who has none, and clears the metadata", async () => {
    await applyPendingInviteName({
      clerkUserId: "u2",
      firstName: null,
      lastName: null,
      publicMetadata: {
        intendedRole: "member",
        intendedFirstName: "Ada",
        intendedLastName: "Lovelace",
      },
    });

    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u2", {
      firstName: "Ada",
      lastName: "Lovelace",
      publicMetadata: {
        intendedRole: "member",
        intendedFirstName: null,
        intendedLastName: null,
      },
    });
  });

  it("applies just the half the invite supplied", async () => {
    await applyPendingInviteName({
      clerkUserId: "u2",
      firstName: null,
      lastName: null,
      publicMetadata: { intendedFirstName: "Ada" },
    });

    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u2", {
      firstName: "Ada",
      publicMetadata: { intendedFirstName: null, intendedLastName: null },
    });
  });

  // The invitee's own choice wins. If Clerk's sign-up form collected a name,
  // the admin's guess at it must not overwrite what the person actually typed.
  it("never overwrites a name the user already has", async () => {
    await applyPendingInviteName({
      clerkUserId: "u2",
      firstName: "Augusta",
      lastName: null,
      publicMetadata: { intendedFirstName: "Ada", intendedLastName: "Lovelace" },
    });

    // Still consumed: leaving it pending would re-apply the moment the user
    // cleared their own name, which is the same re-add bug joinPendingCohort
    // clears metadata to avoid.
    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u2", {
      publicMetadata: { intendedFirstName: null, intendedLastName: null },
    });
  });

  it("does nothing when no name is pending", async () => {
    await applyPendingInviteName({
      clerkUserId: "u2",
      firstName: null,
      lastName: null,
      publicMetadata: { intendedRole: "member" },
    });

    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("ignores non-string and blank metadata values", async () => {
    await applyPendingInviteName({
      clerkUserId: "u2",
      firstName: null,
      lastName: null,
      publicMetadata: { intendedFirstName: 42, intendedLastName: "   " },
    });

    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  // This runs on every authenticated request. A Clerk hiccup must cost the
  // user a name that arrives one request later, never their sign-in.
  it("swallows a Clerk failure so sign-in still succeeds", async () => {
    clerkMock.users.updateUser.mockRejectedValue(new Error("clerk down"));

    await expect(
      applyPendingInviteName({
        clerkUserId: "u2",
        firstName: null,
        lastName: null,
        publicMetadata: { intendedFirstName: "Ada" },
      }),
    ).resolves.toBeUndefined();
  });
});
