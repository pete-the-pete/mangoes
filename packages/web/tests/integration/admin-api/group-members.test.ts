import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: {
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
  userRoleStore: { getRole: vi.fn() },
}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, userRoleStore } from "@/lib/db";
import { POST } from "@/app/admin/api/groups/[groupId]/members/route";
import {
  PATCH,
  DELETE,
} from "@/app/admin/api/groups/[groupId]/members/[clerkUserId]/route";

const clerkMock = {
  users: { getUserList: vi.fn(), updateUser: vi.fn() },
  invitations: { createInvitation: vi.fn(), revokeInvitation: vi.fn() },
};

function asGroupAdmin(clerkUserId = "a1") {
  vi.mocked(requireCohortRole).mockResolvedValue({
    ok: true,
    status: 200,
    clerkUserId,
    platformRole: "admin",
    cohortRole: "admin",
  });
}

const groupParams = { params: Promise.resolve({ groupId: "c1" }) };
const memberParams = (clerkUserId: string) => ({
  params: Promise.resolve({ groupId: "c1", clerkUserId }),
});

function addRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/members", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/members/u2", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireCohortRole).mockReset();
  vi.mocked(cohortStore.listMembers).mockReset();
  vi.mocked(cohortStore.addMember).mockReset();
  vi.mocked(cohortStore.updateMemberRole).mockReset();
  vi.mocked(cohortStore.removeMember).mockReset();
  vi.mocked(userRoleStore.getRole).mockReset();
  clerkMock.users.getUserList.mockReset();
  clerkMock.users.updateUser.mockReset();
  clerkMock.invitations.createInvitation.mockReset();
  clerkMock.invitations.revokeInvitation.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("POST /admin/api/groups/:groupId/members", () => {
  it("adds an existing user directly", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [{ id: "u2" }] });
    const res = await POST(addRequest({ email: "friend@gmail.com" }), groupParams);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: true, clerkUserId: "u2" });
    expect(cohortStore.addMember).toHaveBeenCalledWith("c1", "u2", "member");
    expect(clerkMock.invitations.createInvitation).not.toHaveBeenCalled();
  });

  // One door, two outcomes: an unknown email gets a platform invitation that
  // carries the group id, so accepting it lands them in the right group.
  it("invites an unknown email with the group id in metadata", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });
    const res = await POST(addRequest({ email: "new@gmail.com" }), groupParams);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ invited: true, email: "new@gmail.com" });
    expect(clerkMock.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: "new@gmail.com",
      publicMetadata: { intendedRole: "member", intendedCohortId: "c1" },
    });
    expect(cohortStore.addMember).not.toHaveBeenCalled();
  });

  it("carries the invited name in metadata", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });
    await POST(
      addRequest({ email: "new@gmail.com", firstName: "Ada", lastName: "Lovelace" }),
      groupParams,
    );
    expect(clerkMock.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: "new@gmail.com",
      publicMetadata: {
        intendedRole: "member",
        intendedCohortId: "c1",
        intendedFirstName: "Ada",
        intendedLastName: "Lovelace",
      },
    });
  });

  // A group admin adding someone who already has an account is not allowed to
  // rename them — the name only ever rides on an invitation.
  it("ignores a name when the user already exists", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [{ id: "u2" }] });
    const res = await POST(
      addRequest({ email: "friend@gmail.com", firstName: "Wrong" }),
      groupParams,
    );
    expect(res.status).toBe(201);
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("rejects an over-long name before calling Clerk", async () => {
    asGroupAdmin();
    const res = await POST(
      addRequest({ email: "new@gmail.com", firstName: "x".repeat(65) }),
      groupParams,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "First name must be 64 characters or less",
    });
    expect(clerkMock.users.getUserList).not.toHaveBeenCalled();
  });

  it("rejects a non-gmail address before calling Clerk", async () => {
    asGroupAdmin();
    const res = await POST(addRequest({ email: "friend@example.com" }), groupParams);
    expect(res.status).toBe(400);
    expect(clerkMock.users.getUserList).not.toHaveBeenCalled();
  });

  it("surfaces a Clerk failure as 502", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });
    clerkMock.invitations.createInvitation.mockRejectedValue(new Error("duplicate invitation"));
    const res = await POST(addRequest({ email: "new@gmail.com" }), groupParams);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "duplicate invitation" });
  });
});

describe("PATCH /admin/api/groups/:groupId/members/:clerkUserId", () => {
  const members = [
    { cohortId: "c1", clerkUserId: "a1", role: "admin" as const, createdAt: new Date() },
    { cohortId: "c1", clerkUserId: "u2", role: "member" as const, createdAt: new Date() },
  ];

  it("promotes a platform admin to group admin", async () => {
    asGroupAdmin();
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    vi.mocked(userRoleStore.getRole).mockResolvedValue("admin");
    const res = await PATCH(patchRequest({ role: "admin" }), memberParams("u2"));
    expect(res.status).toBe(200);
    expect(cohortStore.updateMemberRole).toHaveBeenCalledWith("c1", "u2", "admin");
  });

  // The invariant: a group admin who isn't a platform admin can't load the page
  // that administers their group, so the promotion is refused at the source.
  it("refuses to promote a platform member", async () => {
    asGroupAdmin();
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    vi.mocked(userRoleStore.getRole).mockResolvedValue("member");
    const res = await PATCH(patchRequest({ role: "admin" }), memberParams("u2"));
    expect(res.status).toBe(400);
    expect(cohortStore.updateMemberRole).not.toHaveBeenCalled();
  });

  it("blocks demoting the last group admin", async () => {
    asGroupAdmin("owner1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1/members/a1", {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      }),
      memberParams("a1"),
    );
    expect(res.status).toBe(409);
    expect(cohortStore.updateMemberRole).not.toHaveBeenCalled();
  });

  it("refuses a self role change before parsing the body", async () => {
    asGroupAdmin("a1");
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1/members/a1", {
        method: "PATCH",
        body: "not json",
      }),
      memberParams("a1"),
    );
    expect(res.status).toBe(403);
    expect(cohortStore.listMembers).not.toHaveBeenCalled();
  });

  it("rejects an unknown role value", async () => {
    asGroupAdmin();
    const res = await PATCH(patchRequest({ role: "owner" }), memberParams("u2"));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /admin/api/groups/:groupId/members/:clerkUserId", () => {
  const members = [
    { cohortId: "c1", clerkUserId: "a1", role: "admin" as const, createdAt: new Date() },
    { cohortId: "c1", clerkUserId: "a2", role: "admin" as const, createdAt: new Date() },
  ];

  it("removes a member", async () => {
    asGroupAdmin("a1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    const res = await DELETE(
      new Request("http://localhost/admin/api/groups/c1/members/a2", { method: "DELETE" }),
      memberParams("a2"),
    );
    expect(res.status).toBe(200);
    expect(cohortStore.removeMember).toHaveBeenCalledWith("c1", "a2");
  });

  // Unlike a role change, leaving is allowed — an organizer can walk away from a
  // group they're done with, as long as they don't strand it.
  it("allows self-removal when another admin remains", async () => {
    asGroupAdmin("a1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    const res = await DELETE(
      new Request("http://localhost/admin/api/groups/c1/members/a1", { method: "DELETE" }),
      memberParams("a1"),
    );
    expect(res.status).toBe(200);
  });

  it("blocks removing the last admin", async () => {
    asGroupAdmin("a1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue([members[0]!]);
    const res = await DELETE(
      new Request("http://localhost/admin/api/groups/c1/members/a1", { method: "DELETE" }),
      memberParams("a1"),
    );
    expect(res.status).toBe(409);
    expect(cohortStore.removeMember).not.toHaveBeenCalled();
  });
});
