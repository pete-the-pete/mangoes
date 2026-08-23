import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role, UserRoleStore } from "core";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

// Importing auth.ts pulls in ./db, which would otherwise construct a real pg Pool.
vi.mock("./db", () => ({ userRoleStore: undefined }));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "./auth";

function fakeStore(initial: Record<string, Role> = {}): UserRoleStore {
  const roles = new Map(Object.entries(initial));
  return {
    async getRole(id) {
      return roles.get(id);
    },
    async upsertRole(id, role) {
      roles.set(id, role);
    },
    async listRoles() {
      return [...roles.entries()].map(([clerkUserId, role]) => ({
        clerkUserId,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  };
}

function signedInAs(email: string, publicMetadata: Record<string, unknown> = {}) {
  vi.mocked(auth).mockResolvedValue({ userId: "u1" } as never);
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        primaryEmailAddress: { emailAddress: email },
        publicMetadata,
      }),
    },
  } as never);
}

describe("requireRole", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(clerkClient).mockReset();
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await requireRole(["owner"], fakeStore());

    expect(result).toEqual({ ok: false, status: 401, error: "Not signed in" });
  });

  it("returns 403 when the resolved role isn't allowed", async () => {
    signedInAs("friend@gmail.com");

    const result = await requireRole(["owner"], fakeStore({ u1: "member" }));

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Not authorized",
      role: "member",
      clerkUserId: "u1",
    });
  });

  it("returns ok: true when the resolved role is allowed", async () => {
    signedInAs("pete@gmail.com");

    const result = await requireRole(["owner", "admin"], fakeStore({ u1: "owner" }));

    expect(result).toEqual({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
  });
});
