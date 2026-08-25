import { describe, it, expect } from "vitest";
import { wouldRemoveLastCohortAdmin } from "./lastCohortAdminGuard.js";

const members = [
  { clerkUserId: "a1", role: "admin" as const },
  { clerkUserId: "m1", role: "member" as const },
];

describe("wouldRemoveLastCohortAdmin", () => {
  it("blocks demoting the only admin", () => {
    expect(
      wouldRemoveLastCohortAdmin(members, "a1", { type: "role", role: "member" }),
    ).toBe(true);
  });

  it("blocks removing the only admin", () => {
    expect(wouldRemoveLastCohortAdmin(members, "a1", { type: "remove" })).toBe(true);
  });

  it("allows demoting an admin when another remains", () => {
    const two = [...members, { clerkUserId: "a2", role: "admin" as const }];
    expect(
      wouldRemoveLastCohortAdmin(two, "a1", { type: "role", role: "member" }),
    ).toBe(false);
  });

  it("allows removing a plain member", () => {
    expect(wouldRemoveLastCohortAdmin(members, "m1", { type: "remove" })).toBe(false);
  });

  it("is not tripped by a no-op admin-to-admin change", () => {
    expect(
      wouldRemoveLastCohortAdmin(members, "a1", { type: "role", role: "admin" }),
    ).toBe(false);
  });

  it("returns false for a user who is not a member at all", () => {
    expect(wouldRemoveLastCohortAdmin(members, "ghost", { type: "remove" })).toBe(false);
  });
});
