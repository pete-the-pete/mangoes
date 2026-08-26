import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@/lib/db", () => ({ cohortStore: { listMembers: vi.fn() } }));

import { clerkClient } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { listGroupRosterForMember } from "@/lib/memberGroups";

const clerkMock = {
  users: { getUserList: vi.fn() },
};

beforeEach(() => {
  vi.mocked(cohortStore.listMembers).mockReset();
  clerkMock.users.getUserList.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("listGroupRosterForMember", () => {
  it("shows a named peer's name, never their email", async () => {
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

    const rows = await listGroupRosterForMember("c1");
    expect(rows).toEqual([
      { clerkUserId: "u1", displayName: "Dave", avatarUrl: "https://img/1", role: "admin" },
    ]);
    expect(JSON.stringify(rows)).not.toContain("dave@gmail.com");
  });

  it("falls back to a generic, non-identifying label when a peer has no name — not their email", async () => {
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "u2", role: "member", createdAt: new Date() },
    ]);
    clerkMock.users.getUserList.mockResolvedValue({
      data: [
        {
          id: "u2",
          firstName: null,
          lastName: null,
          imageUrl: null,
          primaryEmailAddress: { emailAddress: "u2@gmail.com" },
        },
      ],
    });

    const rows = await listGroupRosterForMember("c1");
    expect(rows).toEqual([
      { clerkUserId: "u2", displayName: "Unnamed member", avatarUrl: null, role: "member" },
    ]);
  });

  it("keeps a member Clerk no longer knows, with the generic label", async () => {
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "ghost", role: "member", createdAt: new Date() },
    ]);
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });

    const rows = await listGroupRosterForMember("c1");
    expect(rows[0]).toMatchObject({ clerkUserId: "ghost", displayName: "Unnamed member" });
  });
});
