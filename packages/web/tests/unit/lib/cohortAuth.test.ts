import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: { getMemberRole: vi.fn() },
}));

import { requireRole } from "@/lib/auth";
import { cohortStore } from "@/lib/db";
import { canManageCohort, requireCohortRole } from "@/lib/cohortAuth";

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(cohortStore.getMemberRole).mockReset();
});

function platform(role: "owner" | "admin", clerkUserId = "u1") {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, status: 200, role, clerkUserId });
}

describe("requireCohortRole", () => {
  it("passes a group admin", async () => {
    platform("admin");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("admin");
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.ok).toBe(true);
    expect(result.cohortRole).toBe("admin");
  });

  it("rejects a group member where admin is required", async () => {
    platform("admin");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("member");
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects a platform admin who is not in the group at all", async () => {
    platform("admin");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue(undefined);
    const result = await requireCohortRole("c1", ["admin", "member"]);
    expect(result.status).toBe(403);
  });

  // The Super Admin can always intervene — spec: Authorization.
  it("passes the platform owner even with no membership row", async () => {
    platform("owner", "owner1");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue(undefined);
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.ok).toBe(true);
    expect(result.platformRole).toBe("owner");
  });

  // The platform gate: /admin/api/* is platform-admin territory, so a plain
  // member who IS in the group still gets nothing here. Their view arrives with
  // the logging slice, on its own surface.
  it("rejects a plain platform member who is a group member", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
      role: "member",
      clerkUserId: "m1",
    });
    const result = await requireCohortRole("c1", ["admin", "member"]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(cohortStore.getMemberRole).not.toHaveBeenCalled();
  });

  it("passes through a 401 when not signed in", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 401,
      error: "Not signed in",
    });
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.status).toBe(401);
  });
});

describe("canManageCohort", () => {
  it("lets the platform owner manage any group, without a membership lookup", async () => {
    expect(await canManageCohort("c1", "o1", "owner")).toBe(true);
    expect(cohortStore.getMemberRole).not.toHaveBeenCalled();
  });

  it("lets a platform admin who is a group admin manage it", async () => {
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("admin");
    expect(await canManageCohort("c1", "a1", "admin")).toBe(true);
  });

  it("refuses a platform admin who is only a plain member of the group", async () => {
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("member");
    expect(await canManageCohort("c1", "a1", "admin")).toBe(false);
  });

  it("refuses a platform admin with no membership in the group at all", async () => {
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue(undefined);
    expect(await canManageCohort("c1", "a1", "admin")).toBe(false);
  });

  it("refuses when no platform role was resolved at all", async () => {
    expect(await canManageCohort("c1", "u1", undefined)).toBe(false);
    expect(cohortStore.getMemberRole).not.toHaveBeenCalled();
  });

  // The platform gate is not a formality: /admin's layout would bounce this
  // person, so offering them a link there would offer a door that won't open.
  it("refuses a group admin whose platform role is still member", async () => {
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("admin");
    expect(await canManageCohort("c1", "m1", "member")).toBe(false);
    expect(cohortStore.getMemberRole).not.toHaveBeenCalled();
  });
});
