import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@/lib/db", () => ({ cohortStore: { listMembers: vi.fn() } }));

import { clerkClient } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { listGroupMembersForAdmin, listPendingGroupInvites } from "@/lib/adminGroups";

const clerkMock = {
  users: { getUserList: vi.fn() },
  invitations: { getInvitationList: vi.fn() },
};

beforeEach(() => {
  vi.mocked(cohortStore.listMembers).mockReset();
  clerkMock.users.getUserList.mockReset();
  clerkMock.invitations.getInvitationList.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("listGroupMembersForAdmin", () => {
  it("joins group roles onto Clerk identities", async () => {
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "u1", role: "admin", createdAt: new Date() },
    ]);
    clerkMock.users.getUserList.mockResolvedValue({
      data: [
        {
          id: "u1",
          firstName: "Dave",
          lastName: null,
          imageUrl: "https://img/1",
          primaryEmailAddress: { emailAddress: "dave@gmail.com" },
        },
      ],
    });

    const rows = await listGroupMembersForAdmin("c1");
    expect(rows).toEqual([
      {
        clerkUserId: "u1",
        email: "dave@gmail.com",
        name: "Dave",
        avatarUrl: "https://img/1",
        role: "admin",
      },
    ]);
  });

  // A membership row whose Clerk user has been deleted must not vanish silently
  // — it still counts toward the admin count the guards read.
  it("keeps a member Clerk no longer knows", async () => {
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "ghost", role: "member", createdAt: new Date() },
    ]);
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });

    const rows = await listGroupMembersForAdmin("c1");
    expect(rows[0]).toMatchObject({ clerkUserId: "ghost", email: null, name: null });
  });
});

describe("listPendingGroupInvites", () => {
  it("returns only invitations tagged for this group", async () => {
    clerkMock.invitations.getInvitationList.mockResolvedValue({
      data: [
        { id: "i1", emailAddress: "new@gmail.com", publicMetadata: { intendedCohortId: "c1" } },
        { id: "i2", emailAddress: "other@gmail.com", publicMetadata: { intendedCohortId: "c2" } },
        { id: "i3", emailAddress: "plain@gmail.com", publicMetadata: {} },
      ],
    });

    const invites = await listPendingGroupInvites("c1");
    expect(invites).toEqual([{ id: "i1", email: "new@gmail.com" }]);
  });
});
