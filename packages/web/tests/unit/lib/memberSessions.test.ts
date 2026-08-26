import { describe, it, expect } from "vitest";
import {
  splitByStatus,
  splitSessionListItems,
  toMemberSessionJson,
  toSessionListItem,
} from "@/lib/memberSessions";

const base = {
  id: "s1", cohortId: "c1", name: "Day 3",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-02T00:00:00Z"),
  closedAt: null, closedBy: null, createdBy: "a1",
  createdAt: new Date(), updatedAt: new Date(),
  participantIds: ["u1"], itemTypeKeys: ["mango"],
};

describe("toMemberSessionJson", () => {
  it("reports a cycle past its end but not closed as live and overdue", () => {
    const json = toMemberSessionJson(base, new Date("2026-09-05T00:00:00Z"));
    expect(json.status).toBe("live");
    expect(json.isOverdue).toBe(true);
  });

  it("serializes dates as ISO strings", () => {
    const json = toMemberSessionJson(base, new Date("2026-09-01T12:00:00Z"));
    expect(json.startsAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("splitByStatus", () => {
  it("groups into live, scheduled, and recent", () => {
    const scheduled = { ...base, id: "s2", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z") };
    const closed = { ...base, id: "s3", closedAt: new Date("2026-09-02T00:00:00Z") };
    const result = splitByStatus([base, scheduled, closed], new Date("2026-09-01T12:00:00Z"));
    expect(result.live.map((s) => s.id)).toEqual(["s1"]);
    expect(result.scheduled.map((s) => s.id)).toEqual(["s2"]);
    expect(result.recent.map((s) => s.id)).toEqual(["s3"]);
  });
});

describe("toSessionListItem", () => {
  it("formats the window in UTC and looks up item emoji, falling back for an unknown key", () => {
    const emojiByKey = new Map([["mango", "🥭"]]);
    const item = toSessionListItem(
      { ...base, itemTypeKeys: ["mango", "unknown-key"] },
      emojiByKey,
      new Date("2026-09-01T12:00:00Z"),
    );
    expect(item.window).toBe("Sep 1, 12:00 AM – Sep 2, 12:00 AM");
    expect(item.itemEmoji).toEqual(["🥭", "•"]);
    expect(item.status).toBe("live");
    expect(item.isOverdue).toBe(false);
  });
});

describe("splitSessionListItems", () => {
  it("groups into live, scheduled, and recent, same as splitByStatus", () => {
    const emojiByKey = new Map([["mango", "🥭"]]);
    const scheduled = { ...base, id: "s2", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z") };
    const closed = { ...base, id: "s3", closedAt: new Date("2026-09-02T00:00:00Z") };
    const result = splitSessionListItems([base, scheduled, closed], emojiByKey, new Date("2026-09-01T12:00:00Z"));
    expect(result.live.map((s) => s.id)).toEqual(["s1"]);
    expect(result.scheduled.map((s) => s.id)).toEqual(["s2"]);
    expect(result.recent.map((s) => s.id)).toEqual(["s3"]);
  });
});
