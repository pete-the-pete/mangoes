import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cycleAuth", () => ({ requireCycleParticipant: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cycleStore: { getCycle: vi.fn() },
  ledgerStore: {
    snapshot: vi.fn(),
    readSince: vi.fn(),
    append: vi.fn(),
  },
  itemTypeStore: { listItemTypes: vi.fn() },
}));

import { requireCycleParticipant } from "@/lib/cycleAuth";
import { ledgerStore } from "@/lib/db";
import { POST as POST_ENTRIES } from "@/app/api/sessions/[sessionId]/entries/route";

const params = { params: Promise.resolve({ sessionId: "s1" }) };
const uuid1 = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";

function asParticipant(clerkUserId = "u1") {
  vi.mocked(requireCycleParticipant).mockResolvedValue({
    ok: true,
    status: 200,
    clerkUserId,
    platformRole: "member",
    isSuperuser: false,
  });
}

function asNonParticipant() {
  vi.mocked(requireCycleParticipant).mockResolvedValue({
    ok: false,
    status: 403,
    error: "Not authorized",
  });
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/sessions/s1/entries", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireCycleParticipant).mockReset();
  vi.mocked(ledgerStore.append).mockReset();
});

describe("POST /api/sessions/:sessionId/entries", () => {
  it("403s a non-participant", async () => {
    asNonParticipant();
    const res = await POST_ENTRIES(
      postRequest({ ops: [{ clientEntryId: uuid1, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }] }),
      params,
    );
    expect(res.status).toBe(403);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("a two-op batch with one accepted and one rejected returns both lists", async () => {
    asParticipant();
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 1,
      accepted: [uuid1],
      duplicates: [],
      rejected: [{ clientEntryId: uuid2, reason: "unknown_item_type" }],
    });

    const res = await POST_ENTRIES(
      postRequest({
        ops: [
          { clientEntryId: uuid1, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" },
          { clientEntryId: uuid2, kind: "log", itemTypeKey: "unknown", occurredAt: "2026-09-01T00:00:00.000Z" },
        ],
      }),
      params,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cursor).toBe(1);
    expect(body.accepted).toEqual([uuid1]);
    expect(body.duplicates).toEqual([]);
    expect(body.rejected).toEqual([
      { clientEntryId: uuid2, reason: "unknown_item_type", message: "That item is not tracked in this session" },
    ]);
    expect(ledgerStore.append).toHaveBeenCalledWith(
      "s1",
      { actorUserId: "u1", canVoidOthers: false, canWriteClosed: false, canWriteForOthers: false },
      expect.any(Array),
    );
  });

  it("reports a replayed clientEntryId as a duplicate without changing cursor", async () => {
    asParticipant();
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 1,
      accepted: [],
      duplicates: [uuid1],
      rejected: [],
    });

    const res = await POST_ENTRIES(
      postRequest({ ops: [{ clientEntryId: uuid1, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }] }),
      params,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicates).toEqual([uuid1]);
    expect(body.cursor).toBe(1);
  });

  it("rejects a member's void of someone else's entry with not_your_entry", async () => {
    asParticipant();
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 0,
      accepted: [],
      duplicates: [],
      rejected: [{ clientEntryId: uuid1, reason: "not_your_entry" }],
    });

    const res = await POST_ENTRIES(
      postRequest({ ops: [{ clientEntryId: uuid1, kind: "void", voidsClientEntryId: uuid2, occurredAt: "2026-09-01T00:00:00.000Z" }] }),
      params,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rejected).toEqual([
      { clientEntryId: uuid1, reason: "not_your_entry", message: "You can only change your own logs" },
    ]);
  });

  it("rejects a write to a closed session with cycle_closed", async () => {
    asParticipant();
    vi.mocked(ledgerStore.append).mockResolvedValue({
      cursor: 0,
      accepted: [],
      duplicates: [],
      rejected: [{ clientEntryId: uuid1, reason: "cycle_closed" }],
    });

    const res = await POST_ENTRIES(
      postRequest({ ops: [{ clientEntryId: uuid1, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }] }),
      params,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rejected).toEqual([
      { clientEntryId: uuid1, reason: "cycle_closed", message: "Only a session admin can amend a closed session" },
    ]);
  });

  it("400s a body carrying subjectUserId", async () => {
    asParticipant();
    const res = await POST_ENTRIES(
      postRequest({
        ops: [{ clientEntryId: uuid1, kind: "log", itemTypeKey: "mango", subjectUserId: "someone-else", occurredAt: "2026-09-01T00:00:00.000Z" }],
      }),
      params,
    );
    expect(res.status).toBe(400);
    expect(ledgerStore.append).not.toHaveBeenCalled();
  });

  it("400s invalid JSON", async () => {
    asParticipant();
    const res = await POST_ENTRIES(
      new Request("http://localhost/api/sessions/s1/entries", { method: "POST", body: "not json" }),
      params,
    );
    expect(res.status).toBe(400);
  });
});
