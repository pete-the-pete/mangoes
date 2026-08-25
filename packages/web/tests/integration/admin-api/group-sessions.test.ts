import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: { listMembers: vi.fn() },
  cycleStore: {
    listCyclesForCohort: vi.fn(),
    createCycle: vi.fn(),
    getCycle: vi.fn(),
    updateCycle: vi.fn(),
    closeCycle: vi.fn(),
    reopenCycle: vi.fn(),
  },
  itemTypeStore: { listItemTypes: vi.fn() },
}));

import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { GET, POST } from "@/app/admin/api/groups/[groupId]/sessions/route";
import { PATCH } from "@/app/admin/api/groups/[groupId]/sessions/[sessionId]/route";
import { POST as CLOSE } from "@/app/admin/api/groups/[groupId]/sessions/[sessionId]/close/route";

const CYCLE = {
  id: "s1",
  cohortId: "c1",
  name: "Beach day",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-08T00:00:00Z"),
  closedAt: null,
  closedBy: null,
  createdBy: "a1",
  createdAt: new Date("2026-08-24T00:00:00Z"),
  updatedAt: new Date("2026-08-24T00:00:00Z"),
  participantIds: ["u1"],
  itemTypeKeys: ["mango"],
};

const groupParams = { params: Promise.resolve({ groupId: "c1" }) };
const sessionParams = { params: Promise.resolve({ groupId: "c1", sessionId: "s1" }) };

function asGroupAdmin() {
  vi.mocked(requireCohortRole).mockResolvedValue({
    ok: true, status: 200, clerkUserId: "a1", platformRole: "admin", cohortRole: "admin",
  });
}

function createRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Beach day",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-08T00:00:00.000Z",
  itemTypeKeys: ["mango"],
  participantIds: ["u1"],
};

beforeEach(() => {
  vi.mocked(requireCohortRole).mockReset();
  vi.mocked(cohortStore.listMembers).mockReset().mockResolvedValue([
    { cohortId: "c1", clerkUserId: "u1", role: "admin", createdAt: new Date() },
  ]);
  vi.mocked(itemTypeStore.listItemTypes).mockReset().mockResolvedValue([
    { key: "mango", emoji: "🥭", label: "Mango", enabled: true, position: 0 },
  ]);
  for (const fn of Object.values(cycleStore)) {
    vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  }
});

describe("GET /admin/api/groups/:groupId/sessions", () => {
  it("returns sessions with derived status", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.listCyclesForCohort).mockResolvedValue([CYCLE]);
    const res = await GET(new Request("http://localhost/x"), groupParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sessions[0]).toMatchObject({ id: "s1", name: "Beach day" });
    expect(["scheduled", "live", "closed"]).toContain(body.sessions[0].status);
  });

  it("403s a non-member", async () => {
    vi.mocked(requireCohortRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    const res = await GET(new Request("http://localhost/x"), groupParams);
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/api/groups/:groupId/sessions", () => {
  it("creates a session", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.createCycle).mockResolvedValue(CYCLE);
    const res = await POST(createRequest(VALID_BODY), groupParams);
    expect(res.status).toBe(201);
    expect(cycleStore.createCycle).toHaveBeenCalledWith(
      expect.objectContaining({ cohortId: "c1", name: "Beach day", createdBy: "a1" }),
    );
  });

  it("rejects a disabled item type", async () => {
    asGroupAdmin();
    const res = await POST(createRequest({ ...VALID_BODY, itemTypeKeys: ["taco"] }), groupParams);
    expect(res.status).toBe(400);
    expect(cycleStore.createCycle).not.toHaveBeenCalled();
  });

  it("rejects a participant outside the group", async () => {
    asGroupAdmin();
    const res = await POST(
      createRequest({ ...VALID_BODY, participantIds: ["stranger"] }),
      groupParams,
    );
    expect(res.status).toBe(400);
  });

  it("only asks the catalog for enabled entries", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.createCycle).mockResolvedValue(CYCLE);
    await POST(createRequest(VALID_BODY), groupParams);
    expect(itemTypeStore.listItemTypes).toHaveBeenCalledWith({ enabledOnly: true });
  });
});

describe("PATCH and close", () => {
  it("404s a session that belongs to another group", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue({ ...CYCLE, cohortId: "other" });
    const res = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name: "New" }) }),
      sessionParams,
    );
    expect(res.status).toBe(404);
    expect(cycleStore.updateCycle).not.toHaveBeenCalled();
  });

  it("updates a session in its own group", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(cycleStore.updateCycle).mockResolvedValue({ ...CYCLE, name: "Renamed" });
    const res = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
      sessionParams,
    );
    expect(res.status).toBe(200);
    expect(cycleStore.updateCycle).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "Renamed" }));
  });

  it("closes a session, recording who did it", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(cycleStore.closeCycle).mockResolvedValue({
      ...CYCLE, closedAt: new Date("2026-09-09T00:00:00Z"), closedBy: "a1",
    });
    const res = await CLOSE(new Request("http://localhost/x", { method: "POST" }), sessionParams);
    expect(res.status).toBe(200);
    expect(cycleStore.closeCycle).toHaveBeenCalledWith("s1", "a1");
  });
});
