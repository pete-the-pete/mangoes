import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { clerkClient } from "@clerk/nextjs/server";
import { POST } from "@/app/admin/api/users/invite/route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/admin/api/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string) {
  return new Request("http://localhost/admin/api/users/invite", {
    method: "POST",
    body,
  });
}

describe("POST /admin/api/users/invite", () => {
  it("returns the guard's status when not owner", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await POST(makeRequest({ email: "a@gmail.com", role: "admin" }));
    expect(res.status).toBe(403);
  });

  it("rejects a non-gmail address without calling Clerk", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const createInvitation = vi.fn();
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: { createInvitation },
    } as never);

    const res = await POST(
      makeRequest({ email: "a@yahoo.com", role: "admin" }),
    );
    expect(res.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const res = await POST(
      makeRequest({ email: "a@gmail.com", role: "owner" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a Clerk invitation with the intended role in metadata", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const createInvitation = vi.fn().mockResolvedValue({});
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: { createInvitation },
    } as never);

    const res = await POST(
      makeRequest({ email: "friend@gmail.com", role: "member" }),
    );
    expect(res.status).toBe(201);
    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "friend@gmail.com",
      publicMetadata: { intendedRole: "member" },
    });
  });

  it("returns 502 when Clerk's invitation call throws", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: {
        createInvitation: vi.fn().mockRejectedValue(new Error("duplicate")),
      },
    } as never);

    const res = await POST(
      makeRequest({ email: "friend@gmail.com", role: "member" }),
    );
    expect(res.status).toBe(502);
  });

  it("returns 400 for a malformed JSON body", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const createInvitation = vi.fn();
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: { createInvitation },
    } as never);

    const res = await POST(makeRawRequest("not json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid JSON body" });
    expect(createInvitation).not.toHaveBeenCalled();
  });
});
