import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { clerkClient } from "@clerk/nextjs/server";
import { PATCH } from "@/app/admin/api/users/[clerkUserId]/name/route";

const clerkMock = { users: { updateUser: vi.fn() } };

const params = { params: Promise.resolve({ clerkUserId: "u2" }) };

function makeRequest(body: unknown) {
  return new Request("http://localhost/admin/api/users/u2/name", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function asAdmin(role: "owner" | "admin" = "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    status: 200,
    role,
    clerkUserId: "a1",
  });
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  clerkMock.users.updateUser.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("PATCH /admin/api/users/:clerkUserId/name", () => {
  it("returns the guard's status when not an admin", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await PATCH(makeRequest({ firstName: "Ada" }), params);
    expect(res.status).toBe(403);
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("sets the target user's name", async () => {
    asAdmin();
    clerkMock.users.updateUser.mockResolvedValue({});

    const res = await PATCH(
      makeRequest({ firstName: " Ada ", lastName: "Lovelace" }),
      params,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u2", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  // Unlike the role route, there is no self-edit block: an admin correcting
  // their own name is the ordinary case, not an escalation.
  it("lets an admin edit their own name", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "admin",
      clerkUserId: "u2",
    });
    clerkMock.users.updateUser.mockResolvedValue({});

    const res = await PATCH(makeRequest({ firstName: "Ada" }), params);

    expect(res.status).toBe(200);
  });

  it("rejects an over-long name", async () => {
    asAdmin("owner");
    const res = await PATCH(makeRequest({ lastName: "x".repeat(65) }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Last name must be 64 characters or less",
    });
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    asAdmin();
    const res = await PATCH(
      new Request("http://localhost/admin/api/users/u2/name", {
        method: "PATCH",
        body: "not json",
      }),
      params,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("returns 502 when Clerk's update throws", async () => {
    asAdmin();
    clerkMock.users.updateUser.mockRejectedValue(new Error("clerk down"));
    const res = await PATCH(makeRequest({ firstName: "Ada" }), params);
    expect(res.status).toBe(502);
  });
});
