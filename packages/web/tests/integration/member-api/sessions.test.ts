import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUserRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cycleStore: {
    listCyclesForParticipant: vi.fn(),
    isCycleParticipant: vi.fn(),
  },
  currentCycleStore: {
    getCurrentCycle: vi.fn(),
    setCurrentCycle: vi.fn(),
    clearCurrentCycle: vi.fn(),
  },
}));

import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore, currentCycleStore } from "@/lib/db";
import { GET as GET_SESSIONS } from "@/app/api/sessions/route";
import { GET as GET_CURRENT, PUT as PUT_CURRENT } from "@/app/api/current-session/route";

const CYCLE_LIVE = {
  id: "s1",
  cohortId: "c1",
  name: "Day 3",
  startsAt: new Date("2026-08-20T00:00:00Z"),
  endsAt: new Date("2026-08-30T00:00:00Z"),
  closedAt: null,
  closedBy: null,
  createdBy: "a1",
  createdAt: new Date("2026-08-19T00:00:00Z"),
  updatedAt: new Date("2026-08-19T00:00:00Z"),
  participantIds: ["u1"],
  itemTypeKeys: ["mango"],
};

const CYCLE_SCHEDULED = {
  ...CYCLE_LIVE,
  id: "s2",
  startsAt: new Date("2026-10-01T00:00:00Z"),
  endsAt: new Date("2026-10-02T00:00:00Z"),
};

const CYCLE_CLOSED = {
  ...CYCLE_LIVE,
  id: "s3",
  closedAt: new Date("2026-08-25T00:00:00Z"),
  closedBy: "a1",
};

function asSignedIn(clerkUserId = "u1") {
  vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId, role: "member" });
}

function putRequest(body: unknown) {
  return new Request("http://localhost/api/current-session", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getCurrentUserRole).mockReset();
  vi.mocked(cycleStore.listCyclesForParticipant).mockReset();
  vi.mocked(cycleStore.isCycleParticipant).mockReset();
  vi.mocked(currentCycleStore.getCurrentCycle).mockReset();
  vi.mocked(currentCycleStore.setCurrentCycle).mockReset();
  vi.mocked(currentCycleStore.clearCurrentCycle).mockReset();
});

describe("GET /api/sessions", () => {
  it("401s when not signed in", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue(null);
    const res = await GET_SESSIONS();
    expect(res.status).toBe(401);
  });

  it("returns only the caller's cycles split into live, scheduled, and recent", async () => {
    asSignedIn("u1");
    vi.mocked(cycleStore.listCyclesForParticipant).mockResolvedValue([
      CYCLE_LIVE,
      CYCLE_SCHEDULED,
      CYCLE_CLOSED,
    ]);
    const res = await GET_SESSIONS();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(cycleStore.listCyclesForParticipant).toHaveBeenCalledWith("u1");
    expect(body.live.map((s: { id: string }) => s.id)).toEqual(["s1"]);
    expect(body.scheduled.map((s: { id: string }) => s.id)).toEqual(["s2"]);
    expect(body.recent.map((s: { id: string }) => s.id)).toEqual(["s3"]);
  });
});

describe("GET /api/current-session", () => {
  it("401s when not signed in", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue(null);
    const res = await GET_CURRENT();
    expect(res.status).toBe(401);
  });

  it("returns { session: null } with status 200 for a stale pointer", async () => {
    asSignedIn("u1");
    vi.mocked(currentCycleStore.getCurrentCycle).mockResolvedValue(undefined);
    const res = await GET_CURRENT();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ session: null });
  });

  it("returns the current session when the pointer resolves", async () => {
    asSignedIn("u1");
    vi.mocked(currentCycleStore.getCurrentCycle).mockResolvedValue(CYCLE_LIVE);
    const res = await GET_CURRENT();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.session).toMatchObject({ id: "s1", groupId: "c1" });
  });
});

describe("PUT /api/current-session", () => {
  it("401s when not signed in", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue(null);
    const res = await PUT_CURRENT(putRequest({ sessionId: "s1" }));
    expect(res.status).toBe(401);
  });

  it("403s a non-participant session id", async () => {
    asSignedIn("u1");
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    const res = await PUT_CURRENT(putRequest({ sessionId: "s1" }));
    expect(res.status).toBe(403);
    expect(currentCycleStore.setCurrentCycle).not.toHaveBeenCalled();
  });

  it("sets the pointer for a participant session id", async () => {
    asSignedIn("u1");
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(true);
    vi.mocked(currentCycleStore.getCurrentCycle).mockResolvedValue(CYCLE_LIVE);
    const res = await PUT_CURRENT(putRequest({ sessionId: "s1" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(currentCycleStore.setCurrentCycle).toHaveBeenCalledWith("u1", "s1");
    expect(body.session).toMatchObject({ id: "s1" });
  });

  it("clears the pointer when sessionId is null", async () => {
    asSignedIn("u1");
    const res = await PUT_CURRENT(putRequest({ sessionId: null }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(currentCycleStore.clearCurrentCycle).toHaveBeenCalledWith("u1");
    expect(body).toEqual({ session: null });
  });

  it("400s when sessionId is neither a string nor null", async () => {
    asSignedIn("u1");
    const res = await PUT_CURRENT(putRequest({ sessionId: 123 }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON body", async () => {
    asSignedIn("u1");
    const res = await PUT_CURRENT(
      new Request("http://localhost/api/current-session", { method: "PUT", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});
