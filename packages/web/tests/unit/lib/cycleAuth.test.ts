import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUserRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cycleStore: { isCycleParticipant: vi.fn(), getCycle: vi.fn() },
  cohortStore: { getMemberRole: vi.fn() },
}));

import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore } from "@/lib/db";
import { requireCycleParticipant } from "@/lib/cycleAuth";

const cycle = {
  id: "s1",
  cohortId: "g1",
  name: "Day 3",
  startsAt: new Date(),
  endsAt: new Date(),
  closedAt: null,
  closedBy: null,
  createdBy: "a1",
  createdAt: new Date(),
  updatedAt: new Date(),
  participantIds: [],
  itemTypeKeys: ["mango"],
};

beforeEach(() => {
  vi.mocked(getCurrentUserRole).mockReset();
  vi.mocked(cycleStore.isCycleParticipant).mockReset();
  vi.mocked(cycleStore.getCycle).mockReset().mockResolvedValue(cycle);
  vi.mocked(cohortStore.getMemberRole).mockReset().mockResolvedValue(undefined);
});

describe("requireCycleParticipant", () => {
  it("401s when nobody is signed in", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue(null);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 401 });
  });

  it("passes a plain platform member who participates", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "u1", role: "member" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(true);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: true, clerkUserId: "u1" });
  });

  it("403s a platform member who does not participate", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "u9", role: "member" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 403 });
  });

  it("403s a platform admin who neither participates nor administers the group", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "a1", role: "admin" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("member");
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 403 });
  });

  it("lets an admin of the session's own group in read-only", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "a1", role: "admin" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("admin");
    const result = await requireCycleParticipant("s1");
    expect(result).toMatchObject({ ok: true, isSuperuser: true, clerkUserId: "a1" });
    expect(cohortStore.getMemberRole).toHaveBeenCalledWith("g1", "a1");
  });

  it("passes the platform owner who does not participate, as a superuser", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "o1", role: "owner" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: true, isSuperuser: true });
  });

  // The reason participation is checked before either escape hatch: an owner
  // who genuinely takes part is a participant, not a superuser, and callers
  // read isSuperuser as "got in without participating".
  it("does not flag a participating owner as a superuser", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "o1", role: "owner" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(true);
    expect(await requireCycleParticipant("s1")).toMatchObject({
      ok: true,
      isSuperuser: false,
      platformRole: "owner",
    });
  });

  // The group-admin hatch has to read the cycle to find its group, which is the
  // one thing that could have made a missing cycle distinguishable from one the
  // caller simply isn't in. Both must still collapse to the same 403.
  it("gives an identical 403 whether the cycle is missing or the caller was removed", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "a1", role: "admin" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);

    vi.mocked(cycleStore.getCycle).mockResolvedValue(undefined);
    const missing = await requireCycleParticipant("missing");

    vi.mocked(cycleStore.getCycle).mockResolvedValue(cycle);
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("member");
    const removed = await requireCycleParticipant("removed-from");

    expect(missing).toEqual(removed);
    expect(missing).toEqual({ ok: false, status: 403, error: "Not authorized" });
  });
});
