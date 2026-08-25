import { describe, it, expect } from "vitest";
import { emptyAggregate, foldEntries, groupTotal, subjectTotal } from "./fold.js";
import { UNTAGGED, type LedgerEntry } from "./types.js";

function entry(over: Partial<LedgerEntry> & { seq: number }): LedgerEntry {
  return {
    id: `e${over.seq}`,
    cycleId: "c1",
    kind: "log",
    itemTypeKey: "mango",
    subjectUserId: "u1",
    actorUserId: "u1",
    voidsEntryId: null,
    clientEntryId: `ce${over.seq}`,
    occurredAt: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...over,
  };
}

describe("emptyAggregate", () => {
  it("starts at cursor zero with no counts", () => {
    expect(emptyAggregate()).toEqual({ cursor: 0, counts: {} });
  });

  it("returns a fresh object each call, not a shared singleton", () => {
    const a = emptyAggregate();
    a.counts["u1"] = { mango: 1 };
    expect(emptyAggregate().counts).toEqual({});
  });
});

describe("foldEntries", () => {
  it("returns the empty aggregate unchanged for no entries", () => {
    expect(foldEntries(emptyAggregate(), [])).toEqual({ cursor: 0, counts: {} });
  });

  it("adds 1 per log and subtracts 1 per void", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1 }),
      entry({ seq: 2 }),
      entry({ seq: 3, kind: "void", voidsEntryId: "e1" }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(result.cursor).toBe(3);
  });

  it("counts untagged entries toward the group but toward no individual", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1, subjectUserId: "u1" }),
      entry({ seq: 2, subjectUserId: null }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(subjectTotal(result, UNTAGGED, "mango")).toBe(1);
    expect(groupTotal(result, "mango")).toBe(2);
  });

  it("lands the same counts whether a void arrives before or after its target", () => {
    const forward = foldEntries(emptyAggregate(), [
      entry({ seq: 1 }),
      entry({ seq: 2, kind: "void", voidsEntryId: "e1" }),
    ]);
    const reversed = foldEntries(emptyAggregate(), [
      entry({ seq: 2, kind: "void", voidsEntryId: "e1" }),
      entry({ seq: 1 }),
    ]);
    expect(forward.counts).toEqual(reversed.counts);
  });

  it("ignores a delta at or below the current cursor, so replays cannot double-count", () => {
    const once = foldEntries(emptyAggregate(), [entry({ seq: 1 }), entry({ seq: 2 })]);
    const twice = foldEntries(once, [entry({ seq: 1 }), entry({ seq: 2 })]);
    expect(subjectTotal(twice, "u1", "mango")).toBe(2);
    expect(twice.cursor).toBe(2);
  });

  it("applies only the new tail when a delta overlaps what was already folded", () => {
    const once = foldEntries(emptyAggregate(), [entry({ seq: 1 }), entry({ seq: 2 })]);
    const overlapping = foldEntries(once, [entry({ seq: 2 }), entry({ seq: 3 })]);
    expect(subjectTotal(overlapping, "u1", "mango")).toBe(3);
    expect(overlapping.cursor).toBe(3);
  });

  it("never mutates the aggregate it is given", () => {
    const before = foldEntries(emptyAggregate(), [entry({ seq: 1 })]);
    const snapshot = structuredClone(before);
    foldEntries(before, [entry({ seq: 2 })]);
    expect(before).toEqual(snapshot);
  });

  it("keeps counts separated per item type", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1, itemTypeKey: "mango" }),
      entry({ seq: 2, itemTypeKey: "taco" }),
      entry({ seq: 3, itemTypeKey: "taco" }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(subjectTotal(result, "u1", "taco")).toBe(2);
  });

  it("keeps counts separated per subject", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1, subjectUserId: "u1" }),
      entry({ seq: 2, subjectUserId: "u2" }),
      entry({ seq: 3, subjectUserId: "u2" }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(subjectTotal(result, "u2", "mango")).toBe(2);
    expect(groupTotal(result, "mango")).toBe(3);
  });

  it("advances the cursor to the highest sequence seen, not the last one in the array", () => {
    const result = foldEntries(emptyAggregate(), [entry({ seq: 7 }), entry({ seq: 4 })]);
    expect(result.cursor).toBe(7);
  });
});

describe("subjectTotal and groupTotal", () => {
  it("report zero for a subject or item nobody has logged", () => {
    const result = foldEntries(emptyAggregate(), [entry({ seq: 1 })]);
    expect(subjectTotal(result, "nobody", "mango")).toBe(0);
    expect(subjectTotal(result, "u1", "taco")).toBe(0);
    expect(groupTotal(result, "taco")).toBe(0);
  });

  it("does not let one item type's count leak into another's group total", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1, itemTypeKey: "mango" }),
      entry({ seq: 2, itemTypeKey: "taco", subjectUserId: "u2" }),
    ]);
    expect(groupTotal(result, "mango")).toBe(1);
    expect(groupTotal(result, "taco")).toBe(1);
  });
});
