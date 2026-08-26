import { describe, it, expect } from "vitest";
import { deriveMemberDisplayName, UNNAMED_MEMBER } from "@/lib/memberDisplayName";

describe("deriveMemberDisplayName", () => {
  it("joins first and last name when both are set", () => {
    expect(deriveMemberDisplayName("Dave", "Smith")).toBe("Dave Smith");
  });

  it("uses whichever of first/last name is set", () => {
    expect(deriveMemberDisplayName("Dave", null)).toBe("Dave");
    expect(deriveMemberDisplayName(null, "Smith")).toBe("Smith");
  });

  it("falls back to the generic, non-identifying label when no name is set", () => {
    expect(deriveMemberDisplayName(null, null)).toBe(UNNAMED_MEMBER);
    expect(deriveMemberDisplayName(undefined, undefined)).toBe(UNNAMED_MEMBER);
  });
});
