import { describe, it, expect } from "vitest";
import {
  splitByStatus,
  splitGroupSessionsByParticipation,
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

describe("splitGroupSessionsByParticipation", () => {
  it("separates the group's sessions the member is in from the ones they aren't", () => {
    const mine = { ...base, id: "s1", participantIds: ["u1", "u2"] };
    const theirs = { ...base, id: "s2", participantIds: ["u2"] };
    const result = splitGroupSessionsByParticipation([mine, theirs], "u1");
    expect([...result.participatingIds]).toEqual(["s1"]);
    expect(result.excludedCount).toBe(1);
  });

  // The state this whole change exists for: joining a group after its sessions
  // were created leaves you in the group and in none of them.
  it("counts every session as excluded for a member in none of them", () => {
    const cycles = [
      { ...base, id: "s1", participantIds: ["u2"] },
      { ...base, id: "s2", participantIds: ["u2", "u3"] },
    ];
    const result = splitGroupSessionsByParticipation(cycles, "u1");
    expect(result.participatingIds.size).toBe(0);
    expect(result.excludedCount).toBe(2);
  });

  it("excludes nothing for a group with no sessions", () => {
    expect(splitGroupSessionsByParticipation([], "u1").excludedCount).toBe(0);
  });
});
