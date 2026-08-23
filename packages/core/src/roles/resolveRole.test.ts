import { describe, it, expect } from "vitest";
import { resolveRole } from "./resolveRole.js";
import type { UserRoleStore } from "./userRoleStore.js";
import type { Role } from "./types.js";

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

describe("resolveRole", () => {
  it("returns the existing role without touching the store further", async () => {
    const store = fakeStore({ u1: "admin" });
    const role = await resolveRole(store, {
      clerkUserId: "u1",
      email: "u1@gmail.com",
      bootstrapEmails: [],
    });
    expect(role).toBe("admin");
  });

  it("bootstraps a matching email as owner when no row exists", async () => {
    const store = fakeStore();
    const role = await resolveRole(store, {
      clerkUserId: "u1",
      email: "Pete@Gmail.com",
      bootstrapEmails: ["pete@gmail.com"],
    });
    expect(role).toBe("owner");
    expect(await store.getRole("u1")).toBe("owner");
  });

  it("uses the invitation's intended role when no row exists and email isn't a bootstrap match", async () => {
    const store = fakeStore();
    const role = await resolveRole(store, {
      clerkUserId: "u2",
      email: "friend@gmail.com",
      bootstrapEmails: ["pete@gmail.com"],
      intendedRoleFromInvitation: "admin",
    });
    expect(role).toBe("admin");
    expect(await store.getRole("u2")).toBe("admin");
  });

  it("falls back to member when no row, no bootstrap match, and no invitation role", async () => {
    const store = fakeStore();
    const role = await resolveRole(store, {
      clerkUserId: "u3",
      email: "stranger@gmail.com",
      bootstrapEmails: ["pete@gmail.com"],
    });
    expect(role).toBe("member");
    expect(await store.getRole("u3")).toBe("member");
  });

  it("accepts an explicitly undefined invitation role", async () => {
    const store = fakeStore();
    const intendedRoleFromInvitation: Role | undefined = undefined;
    const role = await resolveRole(store, {
      clerkUserId: "u4",
      email: "stranger@gmail.com",
      bootstrapEmails: [],
      intendedRoleFromInvitation,
    });
    expect(role).toBe("member");
  });
});
