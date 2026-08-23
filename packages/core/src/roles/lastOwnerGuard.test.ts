import { describe, it, expect } from "vitest";
import { wouldRemoveLastOwner } from "./lastOwnerGuard.js";

describe("wouldRemoveLastOwner", () => {
  it("returns true when demoting the sole owner", () => {
    const roles = [{ clerkUserId: "u1", role: "owner" as const }];
    expect(wouldRemoveLastOwner(roles, "u1", "admin")).toBe(true);
  });

  it("returns false when another owner remains", () => {
    const roles = [
      { clerkUserId: "u1", role: "owner" as const },
      { clerkUserId: "u2", role: "owner" as const },
    ];
    expect(wouldRemoveLastOwner(roles, "u1", "admin")).toBe(false);
  });

  it("returns false when the target is not currently an owner", () => {
    const roles = [{ clerkUserId: "u1", role: "admin" as const }];
    expect(wouldRemoveLastOwner(roles, "u1", "member")).toBe(false);
  });

  it("returns false when the new role is still owner", () => {
    const roles = [{ clerkUserId: "u1", role: "owner" as const }];
    expect(wouldRemoveLastOwner(roles, "u1", "owner")).toBe(false);
  });

  it("returns false when the target user is not found", () => {
    const roles = [{ clerkUserId: "u1", role: "owner" as const }];
    expect(wouldRemoveLastOwner(roles, "u2", "admin")).toBe(false);
  });
});
