import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { clerkClient } from "@clerk/nextjs/server";
import { POST } from "@/app/admin/api/users/invite/route";

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request("http://localhost/admin/api/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
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
      // No Host header on a synthetic undici Request, so this exercises the
      // `new URL(request.url).origin` fallback. Real HTTP/1.1 requests always
      // carry Host; the forwarded-header path is covered below.
      redirectUrl: "http://localhost/sign-up",
    });
  });

  it("builds the return link from the forwarded host, not request.url", async () => {
    // Behind `tailscale serve` (and Vercel) `request.url` carries the internal
    // host with the external scheme, so trusting it would email out a link to
    // https://localhost:3000. The proxy's headers are the only correct source.
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

    await POST(
      makeRequest(
        { email: "friend@gmail.com", role: "admin" },
        {
          "x-forwarded-host": "mangoes.example.ts.net",
          "x-forwarded-proto": "https",
          host: "localhost:3000",
        },
      ),
    );

    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUrl: "https://mangoes.example.ts.net/sign-up",
      }),
    );
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

  it("carries the invited name in metadata alongside the role", async () => {
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
      makeRequest({
        email: "friend@gmail.com",
        role: "member",
        firstName: "  Ada  ",
        lastName: "Lovelace",
      }),
    );

    expect(res.status).toBe(201);
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        publicMetadata: {
          intendedRole: "member",
          intendedFirstName: "Ada",
          intendedLastName: "Lovelace",
        },
      }),
    );
  });

  it("omits the name keys entirely when no name was given", async () => {
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

    await POST(
      makeRequest({ email: "friend@gmail.com", role: "member", firstName: "  " }),
    );

    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ publicMetadata: { intendedRole: "member" } }),
    );
  });

  it("rejects an over-long name without calling Clerk", async () => {
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
      makeRequest({
        email: "friend@gmail.com",
        role: "member",
        lastName: "x".repeat(65),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Last name must be 64 characters or less",
    });
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("rejects a non-string name", async () => {
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
      makeRequest({ email: "friend@gmail.com", role: "member", firstName: 42 }),
    );

    expect(res.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
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
