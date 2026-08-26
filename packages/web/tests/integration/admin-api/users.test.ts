import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/adminUsers", () => ({ listUsersForAdmin: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/adminUsers";
import { GET } from "@/app/admin/api/users/route";

describe("GET /admin/api/users", () => {
  it("returns the guard's status when not authorized", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the merged user list when authorized", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(listUsersForAdmin).mockResolvedValue([
      {
        id: "u1",
        email: "pete@gmail.com",
        name: "Pete",
        firstName: "Pete",
        lastName: "",
        avatarUrl: "x",
        createdAt: "now",
        role: "owner",
      },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
  });
});
