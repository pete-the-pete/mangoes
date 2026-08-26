import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRoleStore } from "core";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { listUsersForAdmin } from "@/lib/adminUsers";

function fakeStore(
  rows: { clerkUserId: string; role: "owner" | "admin" | "member" }[],
): UserRoleStore {
  return {
    async getRole(id) {
      return rows.find((r) => r.clerkUserId === id)?.role;
    },
    async upsertRole() {},
    async listRoles() {
      return rows.map((r) => ({
        ...r,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  };
}

describe("listUsersForAdmin", () => {
  beforeEach(() => vi.mocked(clerkClient).mockReset());

  it("merges Clerk identity with the stored role", async () => {
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUserList: vi.fn().mockResolvedValue({
          data: [
            {
              id: "u1",
              firstName: "Pete",
              lastName: "L",
              imageUrl: "https://example.com/a.png",
              createdAt: 1700000000000,
              primaryEmailAddress: { emailAddress: "pete@gmail.com" },
            },
          ],
        }),
      },
    } as never);

    const result = await listUsersForAdmin(
      fakeStore([{ clerkUserId: "u1", role: "owner" }]),
    );

    expect(result).toEqual([
      {
        id: "u1",
        email: "pete@gmail.com",
        name: "Pete L",
        // Kept alongside the joined name so the roster's inline edit can seed
        // its two fields without splitting `name` on a guess.
        firstName: "Pete",
        lastName: "L",
        avatarUrl: "https://example.com/a.png",
        createdAt: new Date(1700000000000).toISOString(),
        role: "owner",
      },
    ]);
  });

  it("returns role: null for a Clerk user with no stored role row", async () => {
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUserList: vi.fn().mockResolvedValue({
          data: [
            {
              id: "u2",
              firstName: null,
              lastName: null,
              imageUrl: "https://example.com/b.png",
              createdAt: 1700000000000,
              primaryEmailAddress: { emailAddress: "friend@gmail.com" },
            },
          ],
        }),
      },
    } as never);

    const result = await listUsersForAdmin(fakeStore([]));
    expect(result[0]!.role).toBeNull();
    expect(result[0]!.name).toBeNull();
  });
});
