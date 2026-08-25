import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUserRole: vi.fn() }));
vi.mock("@/lib/db", () => ({ cycleStore: { isCycleParticipant: vi.fn() } }));

import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore } from "@/lib/db";
import { requireCycleParticipant } from "@/lib/cycleAuth";

beforeEach(() => {
  vi.mocked(getCurrentUserRole).mockReset();
  vi.mocked(cycleStore.isCycleParticipant).mockReset();
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

  it("403s a platform admin who does not participate — platform role grants nothing here", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "a1", role: "admin" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 403 });
  });

  it("passes the platform owner without checking participation", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "o1", role: "owner" });
    const result = await requireCycleParticipant("s1");
    expect(result).toMatchObject({ ok: true, isSuperuser: true });
    expect(cycleStore.isCycleParticipant).not.toHaveBeenCalled();
  });

  it("gives an identical 403 body whether the cycle is missing or the caller was removed", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "u1", role: "member" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    const a = await requireCycleParticipant("missing");
    const b = await requireCycleParticipant("removed-from");
    expect(a.error).toBe(b.error);
  });
});
