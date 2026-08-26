import { describe, it, expect } from "vitest";
import { MAX_NAME_LENGTH, joinName, parseNameField } from "@/lib/userName";

describe("parseNameField", () => {
  it("treats a missing field as no name rather than an error", () => {
    expect(parseNameField(undefined, "First name")).toEqual({ ok: true, value: null });
    expect(parseNameField(null, "First name")).toEqual({ ok: true, value: null });
  });

  it("trims and keeps a real name", () => {
    expect(parseNameField("  Ada  ", "First name")).toEqual({ ok: true, value: "Ada" });
  });

  // Whitespace-only is the same intent as leaving the field blank, and storing
  // " " would defeat deriveMemberDisplayName's `filter(Boolean)` fallback.
  it("treats a whitespace-only value as blank", () => {
    expect(parseNameField("   ", "Last name")).toEqual({ ok: true, value: null });
  });

  it("rejects a non-string", () => {
    expect(parseNameField(42, "First name")).toEqual({
      ok: false,
      error: "First name must be text",
    });
  });

  it("rejects a value over the length cap, naming the field", () => {
    expect(parseNameField("x".repeat(MAX_NAME_LENGTH + 1), "Last name")).toEqual({
      ok: false,
      error: `Last name must be ${MAX_NAME_LENGTH} characters or less`,
    });
  });

  it("accepts a value exactly at the cap", () => {
    const name = "x".repeat(MAX_NAME_LENGTH);
    expect(parseNameField(name, "First name")).toEqual({ ok: true, value: name });
  });

  // The cap applies to what gets stored, so it is measured after trimming.
  it("measures the cap after trimming", () => {
    const padded = `  ${"x".repeat(MAX_NAME_LENGTH)}  `;
    expect(parseNameField(padded, "First name").ok).toBe(true);
  });
});

describe("joinName", () => {
  it("joins both halves", () => {
    expect(joinName("Ada", "Lovelace")).toBe("Ada Lovelace");
  });

  it("returns whichever half exists", () => {
    expect(joinName("Ada", null)).toBe("Ada");
    expect(joinName(null, "Lovelace")).toBe("Lovelace");
  });

  // null, not UNNAMED_MEMBER: admin surfaces render their own empty state and
  // offer to fill the name in, which a placeholder would paper over.
  it("returns null when there is no name at all", () => {
    expect(joinName(null, undefined)).toBeNull();
    expect(joinName("", "")).toBeNull();
  });
});
