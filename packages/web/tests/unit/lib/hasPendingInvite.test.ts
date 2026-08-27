import { describe, it, expect } from "vitest";
import { hasPendingInvite } from "@/lib/hasPendingInvite";

describe("hasPendingInvite", () => {
  it("is false for metadata with nothing in it", () => {
    expect(hasPendingInvite({})).toBe(false);
  });

  it.each(["intendedCohortId", "intendedFirstName", "intendedLastName"])(
    "is true when %s is a real value",
    (key) => {
      expect(hasPendingInvite({ [key]: "x" })).toBe(true);
    },
  );

  it("is false once a consumer has cleared the keys to null", () => {
    // This is the shape joinPendingCohort and applyPendingInviteName actually
    // leave behind — they null the keys rather than deleting them, so a cleared
    // invite must not read as still pending or the fast path never engages.
    expect(
      hasPendingInvite({
        intendedCohortId: null,
        intendedFirstName: null,
        intendedLastName: null,
      }),
    ).toBe(false);
  });

  it("treats a whitespace-only name as absent, matching pendingName's trim", () => {
    expect(hasPendingInvite({ intendedFirstName: "   " })).toBe(false);
  });

  it("ignores intendedRole, which nothing ever clears", () => {
    // Deliberate: resolveRole only reads intendedRole when there is no role row,
    // and the fast path already requires one. Counting it as pending would
    // strand every invited user on the slow path forever.
    expect(hasPendingInvite({ intendedRole: "admin" })).toBe(false);
  });

  it("ignores unrelated metadata the app does not own", () => {
    expect(hasPendingInvite({ theme: "dark", onboarded: true })).toBe(false);
  });
});
