import { describe, it, expect } from "vitest";
import { DEFAULT_ITEM_TYPE_KEY, ITEM_TYPE_CATALOG } from "@/lib/itemTypeCatalog";

describe("ITEM_TYPE_CATALOG", () => {
  it("has unique keys", () => {
    const keys = ITEM_TYPE_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entry a key, an emoji, and a label", () => {
    for (const entry of ITEM_TYPE_CATALOG) {
      expect(entry.key).toMatch(/^[a-z0-9-]+$/);
      expect(entry.emoji.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("contains the default selection", () => {
    expect(ITEM_TYPE_CATALOG.some((e) => e.key === DEFAULT_ITEM_TYPE_KEY)).toBe(true);
  });

  it("assigns positions in order with no gaps", () => {
    ITEM_TYPE_CATALOG.forEach((entry, index) => {
      expect(entry.position).toBe(index);
    });
  });
});
