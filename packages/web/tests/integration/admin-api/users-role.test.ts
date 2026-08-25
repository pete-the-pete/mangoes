import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  userRoleStore: {
    listRoles: vi.fn(),
    upsertRole: vi.fn(),
    getRole: vi.fn(),
  },
  cohortStore: {
    listAdminMembershipsForUser: vi.fn(),
    demoteAdminMemberships: vi.fn(),
  },
}));

import { requireRole } from "@/lib/auth";
import { cohortStore, userRoleStore } from "@/lib/db";
import { PATCH } from "@/app/admin/api/users/[clerkUserId]/role/route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/admin/api/users/u1/role", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string) {
  return new Request("http://localhost/admin/api/users/u1/role", {
    method: "PATCH",
    body,
  });
}

describe("PATCH /admin/api/users/:clerkUserId/role", () => {
  // The store's mocks accumulate call history across tests in this file (no
  // clearMocks configured), and later tests assert `.not.toHaveBeenCalled()`
  // on them — reset before each test so those assertions reflect only the
  // current test's behavior.
  beforeEach(() => {
    vi.mocked(userRoleStore.listRoles).mockReset();
    vi.mocked(userRoleStore.upsertRole).mockReset();
    vi.mocked(userRoleStore.getRole).mockReset();
    vi.mocked(cohortStore.listAdminMembershipsForUser).mockReset();
    vi.mocked(cohortStore.listAdminMembershipsForUser).mockResolvedValue([]);
    vi.mocked(cohortStore.demoteAdminMemberships).mockReset();
  });

  it("returns the guard's status when not owner", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid role", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "owner1",
    });
    const res = await PATCH(makeRequest({ role: "nonsense" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(400);
  });

  // Rewritten from the plan doc's version, which had the caller PATCH their own
  // id — that now hits the self-role-change 403 below before ever reaching the
  // last-owner guard, so it could never actually exercise this path. Here the
  // caller ("owner2") is a different user than the target ("u1"), which is
  // artificial: with the self-change rule in place, a real caller who is the
  // *only* owner can never trigger this 409 by demoting themselves (they'd get
  // 403 first), and no other owner exists to demote them. wouldRemoveLastOwner
  // is kept as defense-in-depth for future non-interactive callers (e.g. an
  // admin script) that could reach this handler without the self-change guard
  // in front of them.
  it("blocks demoting the last remaining owner", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "owner2",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      {
        clerkUserId: "u1",
        role: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(409);
    expect(userRoleStore.upsertRole).not.toHaveBeenCalled();
  });

  it("updates the role when allowed", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      {
        clerkUserId: "u1",
        role: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        clerkUserId: "u2",
        role: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u2" }),
    });
    expect(res.status).toBe(200);
    expect(userRoleStore.upsertRole).toHaveBeenCalledWith("u2", "admin");
  });

  it("returns 403 when the caller tries to change their own role", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "You cannot change your own role" });
    expect(userRoleStore.listRoles).not.toHaveBeenCalled();
    expect(userRoleStore.upsertRole).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "owner1",
    });
    const res = await PATCH(makeRawRequest("not json"), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid JSON body" });
    expect(userRoleStore.upsertRole).not.toHaveBeenCalled();
  });
  // The invariant has two write paths, and this is the one v0.1 never knew about:
  // demoting a platform admin who is a group's only admin would leave that group
  // with an admin row that grants nothing, reachable by nobody but the owner.
  it("blocks demoting the last admin of a group", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, status: 200, role: "owner", clerkUserId: "owner1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      { clerkUserId: "owner1", role: "owner", createdAt: new Date(), updatedAt: new Date() },
      { clerkUserId: "u1", role: "admin", createdAt: new Date(), updatedAt: new Date() },
    ]);
    vi.mocked(cohortStore.listAdminMembershipsForUser).mockResolvedValue([
      { cohortId: "c1", cohortName: "Cabo", adminCount: 1 },
    ]);

    const res = await PATCH(makeRequest({ role: "member" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Cabo");
    expect(userRoleStore.upsertRole).not.toHaveBeenCalled();
  });

  it("cascades group admin roles when another admin remains", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, status: 200, role: "owner", clerkUserId: "owner1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      { clerkUserId: "owner1", role: "owner", createdAt: new Date(), updatedAt: new Date() },
      { clerkUserId: "u1", role: "admin", createdAt: new Date(), updatedAt: new Date() },
    ]);
    vi.mocked(cohortStore.listAdminMembershipsForUser).mockResolvedValue([
      { cohortId: "c1", cohortName: "Cabo", adminCount: 2 },
    ]);

    const res = await PATCH(makeRequest({ role: "member" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });

    expect(res.status).toBe(200);
    expect(userRoleStore.upsertRole).toHaveBeenCalledWith("u1", "member");
    expect(cohortStore.demoteAdminMemberships).toHaveBeenCalledWith("u1");
  });

  it("leaves group memberships alone when promoting", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, status: 200, role: "owner", clerkUserId: "owner1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      { clerkUserId: "owner1", role: "owner", createdAt: new Date(), updatedAt: new Date() },
      { clerkUserId: "u1", role: "member", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });

    expect(res.status).toBe(200);
    expect(cohortStore.listAdminMembershipsForUser).not.toHaveBeenCalled();
    expect(cohortStore.demoteAdminMemberships).not.toHaveBeenCalled();
  });
});
