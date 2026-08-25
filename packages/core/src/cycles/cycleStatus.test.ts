import { describe, it, expect } from "vitest";
import { deriveCycleStatus, isCycleOverdue } from "./cycleStatus.js";

const now = new Date("2026-08-24T12:00:00Z");
const window = (startsAt: string, endsAt: string, closedAt: Date | null = null) => ({
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  closedAt,
});

describe("deriveCycleStatus", () => {
  it("is scheduled before the window opens", () => {
    expect(deriveCycleStatus(window("2026-08-25T00:00:00Z", "2026-08-26T00:00:00Z"), now))
      .toBe("scheduled");
  });

  it("is live inside the window", () => {
    expect(deriveCycleStatus(window("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z"), now))
      .toBe("live");
  });

  // The decision that separates this product from a timer: closing is a
  // deliberate act, so a forgotten session is still live and still writable.
  it("is still live after the window ends when nobody closed it", () => {
    expect(deriveCycleStatus(window("2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z"), now))
      .toBe("live");
  });

  it("is closed once closedAt is set, even inside the window", () => {
    const closed = window("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z", now);
    expect(deriveCycleStatus(closed, now)).toBe("closed");
  });
});

describe("isCycleOverdue", () => {
  it("flags an open cycle past its end time", () => {
    expect(isCycleOverdue(window("2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z"), now))
      .toBe(true);
  });

  it("does not flag a closed cycle past its end time", () => {
    const closed = window("2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z", now);
    expect(isCycleOverdue(closed, now)).toBe(false);
  });

  it("does not flag a cycle inside its window", () => {
    expect(isCycleOverdue(window("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z"), now))
      .toBe(false);
  });
});
