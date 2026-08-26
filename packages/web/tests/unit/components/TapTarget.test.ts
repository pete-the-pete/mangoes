import { describe, it, expect } from "vitest";
import { pickLayout } from "@/components/TapTarget";

describe("pickLayout", () => {
  it("picks large for a single item type", () => {
    expect(pickLayout(0)).toBe("large");
    expect(pickLayout(1)).toBe("large");
  });

  it("picks grid for 2-4 item types", () => {
    expect(pickLayout(2)).toBe("grid");
    expect(pickLayout(4)).toBe("grid");
  });

  it("picks compact for 5+ item types", () => {
    expect(pickLayout(5)).toBe("compact");
    expect(pickLayout(20)).toBe("compact");
  });
});
