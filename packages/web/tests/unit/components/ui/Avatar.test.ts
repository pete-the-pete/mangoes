import { describe, expect, it } from "vitest";
import { fillForName } from "@/components/ui/Avatar";

describe("fillForName", () => {
  it("is stable for the same name", () => {
    expect(fillForName("Dave")).toBe(fillForName("Dave"));
  });

  it("gives adjacent names on a small roster different colors", () => {
    // The point of the avatar color: telling people apart at a glance in a
    // leaderboard row. A hash that collides on short names defeats it.
    const roster = ["Dave", "Marisol", "Sam", "Jo", "Tia R.", "Pete"];
    const fills = roster.map(fillForName);
    expect(new Set(fills).size).toBeGreaterThanOrEqual(4);
  });

  it("handles the empty name the no-name avatar falls back to", () => {
    expect(fillForName("")).toMatch(/^bg-/);
  });
});
