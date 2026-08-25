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
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, ledgerStore, itemTypeStore } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";
import { GET as GET_SNAPSHOT } from "@/app/api/sessions/[sessionId]/snapshot/route";
import { GET as GET_ENTRIES } from "@/app/api/sessions/[sessionId]/entries/route";

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
  participantIds: ["u1", "u2"],
  itemTypeKeys: ["mango", "taco"],
};

const ENTRY_1 = {
  id: "e1",
  cycleId: "s1",
  seq: 1,
  kind: "log" as const,
  itemTypeKey: "mango",
  subjectUserId: "u1",
  actorUserId: "u1",
  voidsEntryId: null,
  clientEntryId: "11111111-1111-4111-8111-111111111111",
  occurredAt: new Date("2026-09-01T01:00:00Z"),
  createdAt: new Date("2026-09-01T01:00:00Z"),
};

const ENTRY_2 = {
  ...ENTRY_1,
  id: "e2",
  seq: 2,
  clientEntryId: "22222222-2222-4222-8222-222222222222",
  occurredAt: new Date("2026-09-01T02:00:00Z"),
  createdAt: new Date("2026-09-01T02:00:00Z"),
};

const params = { params: Promise.resolve({ sessionId: "s1" }) };

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

function entriesRequest(query = "") {
  return new Request(`http://localhost/api/sessions/s1/entries${query}`);
}

beforeEach(() => {
  vi.mocked(requireCycleParticipant).mockReset();
  vi.mocked(cycleStore.getCycle).mockReset();
  vi.mocked(ledgerStore.snapshot).mockReset();
  vi.mocked(ledgerStore.readSince).mockReset();
  vi.mocked(itemTypeStore.listItemTypes).mockReset().mockResolvedValue([
    { key: "mango", emoji: "🥭", label: "Mango", enabled: true, position: 0 },
    { key: "taco", emoji: "🌮", label: "Taco", enabled: false, position: 1 },
  ]);
  vi.mocked(clerkClient).mockReset().mockResolvedValue({
    users: {
      getUserList: vi.fn().mockResolvedValue({
        data: [
          { id: "u1", firstName: "Pete", lastName: "L", imageUrl: "https://x/u1.png", primaryEmailAddress: { emailAddress: "pete@gmail.com" } },
          { id: "u2", firstName: null, lastName: null, imageUrl: "https://x/u2.png", primaryEmailAddress: { emailAddress: "friend@gmail.com" } },
        ],
      }),
    },
  } as never);
});

describe("GET /api/sessions/:sessionId/snapshot", () => {
  it("403s a non-participant", async () => {
    asNonParticipant();
    const res = await GET_SNAPSHOT(new Request("http://localhost/x"), params);
    expect(res.status).toBe(403);
    expect(cycleStore.getCycle).not.toHaveBeenCalled();
  });

  it("returns cursor, counts, item types in cycle order, and joined participants", async () => {
    asParticipant();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.snapshot).mockResolvedValue({
      cursor: 2,
      counts: { u1: { mango: 1 } },
    });

    const res = await GET_SNAPSHOT(new Request("http://localhost/x"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session).toMatchObject({ id: "s1" });
    expect(body.cursor).toBe(2);
    expect(body.counts).toEqual({ u1: { mango: 1 } });
    // itemTypes follows the cycle's own itemTypeKeys order, taco included even
    // though it's disabled in the catalog — disabling is picker-only.
    expect(body.itemTypes).toEqual([
      { key: "mango", emoji: "🥭", label: "Mango" },
      { key: "taco", emoji: "🌮", label: "Taco" },
    ]);
    expect(body.participants).toEqual([
      { clerkUserId: "u1", name: "Pete L", imageUrl: "https://x/u1.png" },
      { clerkUserId: "u2", name: "friend@gmail.com", imageUrl: "https://x/u2.png" },
    ]);
  });

  it("returns no participants and never calls Clerk for a participantless cycle", async () => {
    // Reachable via the platform-owner superuser path in requireCycleParticipant,
    // which bypasses participation. An empty userId filter is not guaranteed to
    // mean "match none" in Clerk's list API, so the route must short-circuit
    // rather than pass `userId: []` through.
    asParticipant();
    vi.mocked(cycleStore.getCycle).mockResolvedValue({ ...CYCLE, participantIds: [] });
    vi.mocked(ledgerStore.snapshot).mockResolvedValue({ cursor: 0, counts: {} });

    const res = await GET_SNAPSHOT(new Request("http://localhost/x"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participants).toEqual([]);
    expect(vi.mocked(clerkClient).mock.results[0]?.value).toBeDefined();
    const clerk = await vi.mocked(clerkClient).mock.results[0]!.value;
    expect(clerk.users.getUserList).not.toHaveBeenCalled();
  });

  it("orders participants by cycle.participantIds regardless of Clerk's response order", async () => {
    // Clerk's getUserList does not guarantee response order, so deliberately
    // return the participants reversed from CYCLE.participantIds (["u1","u2"])
    // and require the output to still come back in the cycle's own order.
    asParticipant();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(ledgerStore.snapshot).mockResolvedValue({ cursor: 0, counts: {} });
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUserList: vi.fn().mockResolvedValue({
          data: [
            { id: "u2", firstName: null, lastName: null, imageUrl: "https://x/u2.png", primaryEmailAddress: { emailAddress: "friend@gmail.com" } },
            { id: "u1", firstName: "Pete", lastName: "L", imageUrl: "https://x/u1.png", primaryEmailAddress: { emailAddress: "pete@gmail.com" } },
          ],
        }),
      },
    } as never);

    const res = await GET_SNAPSHOT(new Request("http://localhost/x"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participants.map((p: { clerkUserId: string }) => p.clerkUserId)).toEqual(["u1", "u2"]);
  });
});

describe("GET /api/sessions/:sessionId/entries", () => {
  it("403s a non-participant", async () => {
    asNonParticipant();
    const res = await GET_ENTRIES(entriesRequest(), params);
    expect(res.status).toBe(403);
    expect(ledgerStore.readSince).not.toHaveBeenCalled();
  });

  it("returns everything with after=0", async () => {
    asParticipant();
    vi.mocked(ledgerStore.readSince).mockResolvedValue({
      entries: [ENTRY_1, ENTRY_2],
      nextCursor: 2,
      hasMore: false,
    });

    const res = await GET_ENTRIES(entriesRequest(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(ledgerStore.readSince).toHaveBeenCalledWith("s1", 0, 500);
    expect(body.entries).toEqual([
      {
        id: "e1", seq: 1, kind: "log", itemTypeKey: "mango", subjectUserId: "u1",
        actorUserId: "u1", clientEntryId: ENTRY_1.clientEntryId, occurredAt: "2026-09-01T01:00:00.000Z",
      },
      {
        id: "e2", seq: 2, kind: "log", itemTypeKey: "mango", subjectUserId: "u1",
        actorUserId: "u1", clientEntryId: ENTRY_2.clientEntryId, occurredAt: "2026-09-01T02:00:00.000Z",
      },
    ]);
    expect(body.nextCursor).toBe(2);
    expect(body.hasMore).toBe(false);
  });

  it("pages: hasMore true then false", async () => {
    asParticipant();
    vi.mocked(ledgerStore.readSince).mockResolvedValueOnce({
      entries: [ENTRY_1],
      nextCursor: 1,
      hasMore: true,
    });
    const first = await GET_ENTRIES(entriesRequest("?after=0"), params);
    const firstBody = await first.json();
    expect(firstBody.hasMore).toBe(true);
    expect(ledgerStore.readSince).toHaveBeenCalledWith("s1", 0, 500);

    vi.mocked(ledgerStore.readSince).mockResolvedValueOnce({
      entries: [ENTRY_2],
      nextCursor: 2,
      hasMore: false,
    });
    const second = await GET_ENTRIES(entriesRequest("?after=1"), params);
    const secondBody = await second.json();
    expect(secondBody.hasMore).toBe(false);
    expect(ledgerStore.readSince).toHaveBeenCalledWith("s1", 1, 500);
  });

  it("400s a non-numeric after", async () => {
    asParticipant();
    const res = await GET_ENTRIES(entriesRequest("?after=nope"), params);
    expect(res.status).toBe(400);
    expect(ledgerStore.readSince).not.toHaveBeenCalled();
  });

  it("400s a negative after", async () => {
    asParticipant();
    const res = await GET_ENTRIES(entriesRequest("?after=-1"), params);
    expect(res.status).toBe(400);
  });
});
