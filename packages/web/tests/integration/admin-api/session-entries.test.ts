import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cycleStore: { getCycle: vi.fn() },
  ledgerStore: { append: vi.fn(), getEntryById: vi.fn() },
}));

import { requireCohortRole } from "@/lib/cohortAuth";
import { cycleStore, ledgerStore } from "@/lib/db";
import { POST as APPEND } from "@/app/admin/api/groups/[groupId]/sessions/[sessionId]/entries/route";
import { POST as VOID } from "@/app/admin/api/groups/[groupId]/sessions/[sessionId]/entries/[entryId]/void/route";

const CYCLE = {
  id: "s1",
  cohortId: "c1",
  name: "Beach day",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-08T00:00:00Z"),
  closedAt: new Date("2026-09-09T00:00:00Z"),
  closedBy: "a1",
  createdBy: "a1",
  createdAt: new Date("2026-08-24T00:00:00Z"),
  updatedAt: new Date("2026-08-24T00:00:00Z"),
  participantIds: ["u1", "u2"],
  itemTypeKeys: ["mango"],
};

const ENTRY = {
  id: "e1",
  cycleId: "s1",
  seq: 1,
  kind: "log" as const,
  itemTypeKey: "mango",
  subjectUserId: "u1",
  actorUserId: "u1",
  voidsEntryId: null,
  clientEntryId: "ce1",
  occurredAt: new Date("2026-09-01T00:00:00Z"),
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

const sessionParams = { params: Promise.resolve({ groupId: "c1", sessionId: "s1" }) };
const entryParams = { params: Promise.resolve({ groupId: "c1", sessionId: "s1", entryId: "e1" }) };

function asGroupAdmin() {
  vi.mocked(requireCohortRole).mockResolvedValue({
    ok: true,
    status: 200,
    clerkUserId: "a1",
    platformRole: "admin",
    cohortRole: "admin",
  });
}

function appendRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/sessions/s1/entries", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireCohortRole).mockReset();
  vi.mocked(cycleStore.getCycle).mockReset();
  vi.mocked(ledgerStore.append).mockReset();
  vi.mocked(ledgerStore.getEntryById).mockReset();
});

describe("POST /admin/api/groups/:groupId/sessions/:sessionId/entries", () => {
  it("403s a non-admin", async () => {
    vi.mocked(requireCohortRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    const res = await APPEND(appendRequest({ itemTypeKey: "mango", subjectUserId: "u1" }), sessionParams);
    expect(res.status).toBe(403);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("404s a session belonging to a different group", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue({ ...CYCLE, cohortId: "other" });
    const res = await APPEND(appendRequest({ itemTypeKey: "mango", subjectUserId: "u1" }), sessionParams);
    expect(res.status).toBe(404);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("404s a session that does not exist", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(undefined);
    const res = await APPEND(appendRequest({ itemTypeKey: "mango", subjectUserId: "u1" }), sessionParams);
    expect(res.status).toBe(404);
  });

  it("stores subjectUserId: null for an untagged write", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 1,
      accepted: ["x"],
      duplicates: [],
      rejected: [],
    });
    const res = await APPEND(appendRequest({ itemTypeKey: "mango", subjectUserId: null }), sessionParams);
    expect(res.status).toBe(201);
    expect(ledgerStore.append).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ actorUserId: "a1", canWriteForOthers: true }),
      [expect.objectContaining({ kind: "log", itemTypeKey: "mango", subjectUserId: null })],
    );
  });

  it("passes a distinct actor and subject for an on-behalf write", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 1,
      accepted: ["x"],
      duplicates: [],
      rejected: [],
    });
    const res = await APPEND(
      appendRequest({ itemTypeKey: "mango", subjectUserId: "u2" }),
      sessionParams,
    );
    expect(res.status).toBe(201);
    expect(ledgerStore.append).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ actorUserId: "a1" }),
      [expect.objectContaining({ subjectUserId: "u2" })],
    );
  });

  it("writes to a closed session, unlike a member's write", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE); // CYCLE is closed
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 1,
      accepted: ["x"],
      duplicates: [],
      rejected: [],
    });
    const res = await APPEND(appendRequest({ itemTypeKey: "mango", subjectUserId: "u1" }), sessionParams);
    expect(res.status).toBe(201);
    expect(ledgerStore.append).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ canWriteClosed: true }),
      expect.anything(),
    );
  });

  it("400s an item type not tracked by the session", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    const res = await APPEND(appendRequest({ itemTypeKey: "taco", subjectUserId: "u1" }), sessionParams);
    expect(res.status).toBe(400);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("400s a subject not in the session", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    const res = await APPEND(
      appendRequest({ itemTypeKey: "mango", subjectUserId: "stranger" }),
      sessionParams,
    );
    expect(res.status).toBe(400);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("surfaces a rejection as a human-readable message", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 0,
      accepted: [],
      duplicates: [],
      rejected: [{ clientEntryId: "x", reason: "unknown_item_type" }],
    });
    const res = await APPEND(appendRequest({ itemTypeKey: "mango", subjectUserId: "u1" }), sessionParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("That item is not tracked in this session");
  });
});

describe("POST /admin/api/groups/:groupId/sessions/:sessionId/entries/:entryId/void", () => {
  it("403s a non-admin", async () => {
    vi.mocked(requireCohortRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    const res = await VOID(new Request("http://localhost/x", { method: "POST" }), entryParams);
    expect(res.status).toBe(403);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("404s a session belonging to a different group", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue({ ...CYCLE, cohortId: "other" });
    const res = await VOID(new Request("http://localhost/x", { method: "POST" }), entryParams);
    expect(res.status).toBe(404);
    expect(ledgerStore.getEntryById).not.toHaveBeenCalled();
  });

  it("404s an entry that does not exist", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.getEntryById).mockResolvedValue(undefined);
    const res = await VOID(new Request("http://localhost/x", { method: "POST" }), entryParams);
    expect(res.status).toBe(404);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("resolves the target by server id and appends a void with admin powers", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.getEntryById).mockResolvedValue(ENTRY);
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 2,
      accepted: ["x"],
      duplicates: [],
      rejected: [],
    });
    const res = await VOID(new Request("http://localhost/x", { method: "POST" }), entryParams);
    expect(res.status).toBe(200);
    expect(ledgerStore.getEntryById).toHaveBeenCalledWith("s1", "e1");
    expect(ledgerStore.append).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ actorUserId: "a1", canVoidOthers: true, canWriteClosed: true }),
      [expect.objectContaining({ kind: "void", voidsClientEntryId: "ce1" })],
    );
  });

  it("surfaces a rejection as a human-readable message", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.getEntryById).mockResolvedValue(ENTRY);
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 1,
      accepted: [],
      duplicates: [],
      rejected: [{ clientEntryId: "x", reason: "already_voided" }],
    });
    const res = await VOID(new Request("http://localhost/x", { method: "POST" }), entryParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("That log was already removed");
  });
});
