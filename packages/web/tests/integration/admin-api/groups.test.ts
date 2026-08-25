import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: {
    listCohorts: vi.fn(),
    listCohortsForUser: vi.fn(),
    createCohort: vi.fn(),
    getCohort: vi.fn(),
    renameCohort: vi.fn(),
    listMembers: vi.fn(),
  },
}));

import { requireRole } from "@/lib/auth";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";
import { GET, POST } from "@/app/admin/api/groups/route";
import { GET as GET_ONE, PATCH } from "@/app/admin/api/groups/[groupId]/route";

const COHORT = {
  id: "c1",
  name: "Cabo",
  createdBy: "u1",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

function asPlatform(role: "owner" | "admin", clerkUserId = "u1") {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, status: 200, role, clerkUserId });
}

function asGroup(ok: boolean, status = 200) {
  vi.mocked(requireCohortRole).mockResolvedValue(
    ok
      ? { ok: true, status: 200, clerkUserId: "u1", platformRole: "admin", cohortRole: "admin" }
      : { ok: false, status, error: "Not authorized" },
  );
}

function post(body: unknown) {
  return new Request("http://localhost/admin/api/groups", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireCohortRole).mockReset();
  for (const fn of Object.values(cohortStore)) {
    vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  }
});

describe("GET /admin/api/groups", () => {
  it("returns every group for the owner", async () => {
    asPlatform("owner");
    vi.mocked(cohortStore.listCohorts).mockResolvedValue([COHORT]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      groups: [{ id: "c1", name: "Cabo", createdAt: COHORT.createdAt.toISOString() }],
    });
    expect(cohortStore.listCohortsForUser).not.toHaveBeenCalled();
  });

  it("returns only their own groups for an admin", async () => {
    asPlatform("admin", "a1");
    vi.mocked(cohortStore.listCohortsForUser).mockResolvedValue([]);
    await GET();
    expect(cohortStore.listCohortsForUser).toHaveBeenCalledWith("a1");
    expect(cohortStore.listCohorts).not.toHaveBeenCalled();
  });

  it("passes the guard's rejection through", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    expect((await GET()).status).toBe(403);
  });
});

describe("POST /admin/api/groups", () => {
  it("creates a group with the caller as its admin", async () => {
    asPlatform("admin", "a1");
    vi.mocked(cohortStore.createCohort).mockResolvedValue(COHORT);
    const res = await POST(post({ name: "Cabo" }));
    expect(res.status).toBe(201);
    expect(cohortStore.createCohort).toHaveBeenCalledWith({ name: "Cabo", createdBy: "a1" });
  });

  it("rejects a blank name", async () => {
    asPlatform("admin");
    const res = await POST(post({ name: "   " }));
    expect(res.status).toBe(400);
    expect(cohortStore.createCohort).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    asPlatform("admin");
    const res = await POST(
      new Request("http://localhost/admin/api/groups", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/api/groups/:groupId", () => {
  it("returns the group with its members", async () => {
    asGroup(true);
    vi.mocked(cohortStore.getCohort).mockResolvedValue(COHORT);
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "u1", role: "admin", createdAt: COHORT.createdAt },
    ]);
    const res = await GET_ONE(new Request("http://localhost/admin/api/groups/c1"), {
      params: Promise.resolve({ groupId: "c1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.group.name).toBe("Cabo");
    expect(body.members).toEqual([{ clerkUserId: "u1", role: "admin" }]);
  });

  it("404s an unknown group", async () => {
    asGroup(true);
    vi.mocked(cohortStore.getCohort).mockResolvedValue(undefined);
    const res = await GET_ONE(new Request("http://localhost/admin/api/groups/nope"), {
      params: Promise.resolve({ groupId: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("403s a non-member", async () => {
    asGroup(false, 403);
    const res = await GET_ONE(new Request("http://localhost/admin/api/groups/c1"), {
      params: Promise.resolve({ groupId: "c1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /admin/api/groups/:groupId", () => {
  it("renames the group", async () => {
    asGroup(true);
    vi.mocked(cohortStore.renameCohort).mockResolvedValue({ ...COHORT, name: "Cabo 2026" });
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Cabo 2026" }),
      }),
      { params: Promise.resolve({ groupId: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect(cohortStore.renameCohort).toHaveBeenCalledWith("c1", "Cabo 2026");
  });

  it("requires the group admin role", async () => {
    asGroup(false, 403);
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Nope" }),
      }),
      { params: Promise.resolve({ groupId: "c1" }) },
    );
    expect(res.status).toBe(403);
    expect(cohortStore.renameCohort).not.toHaveBeenCalled();
  });
});
