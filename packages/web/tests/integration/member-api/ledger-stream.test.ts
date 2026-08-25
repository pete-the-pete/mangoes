import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/cycleAuth", () => ({ requireCycleParticipant: vi.fn() }));
vi.mock("@/lib/db", () => ({ ledgerStore: { readSince: vi.fn() } }));

import { requireCycleParticipant } from "@/lib/cycleAuth";
import { ledgerStore } from "@/lib/db";
import { GET } from "@/app/api/sessions/[sessionId]/stream/route";

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
  vi.mocked(requireCycleParticipant).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
}

function streamRequest(query = "") {
  const controller = new AbortController();
  const request = new Request(`http://localhost/api/sessions/s1/stream${query}`, {
    signal: controller.signal,
  });
  return { request, controller };
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> {
  const { value, done } = await reader.read();
  if (done || !value) return null;
  return new TextDecoder().decode(value);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(requireCycleParticipant).mockReset();
  vi.mocked(ledgerStore.readSince).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/sessions/:sessionId/stream", () => {
  it("403s a non-participant before opening a stream", async () => {
    asNonParticipant();
    const { request } = streamRequest();
    const res = await GET(request, params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Not authorized" });
  });

  it("emits a keepalive comment on the poll tick when there's nothing new", async () => {
    asParticipant();
    vi.mocked(ledgerStore.readSince).mockResolvedValue({ entries: [], nextCursor: 0, hasMore: false });

    const { request, controller } = streamRequest();
    const res = await GET(request, params);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    await vi.advanceTimersByTimeAsync(2000);
    const frame = await readFrame(reader);

    expect(frame).toBe(": keepalive\n\n");
    controller.abort();
  });

  it("emits a data frame in the same shape as GET /entries and advances the cursor for the next poll", async () => {
    asParticipant();
    const entry = {
      id: "e1",
      cycleId: "s1",
      seq: 1,
      kind: "log" as const,
      itemTypeKey: "mango",
      subjectUserId: "u1",
      actorUserId: "u1",
      voidsEntryId: null,
      clientEntryId: "11111111-1111-4111-8111-111111111111",
      occurredAt: new Date("2026-09-01T00:00:00Z"),
      createdAt: new Date("2026-09-01T00:00:00Z"),
    };
    vi.mocked(ledgerStore.readSince)
      .mockResolvedValueOnce({ entries: [entry], nextCursor: 1, hasMore: false })
      .mockResolvedValue({ entries: [], nextCursor: 1, hasMore: false });

    const { request, controller } = streamRequest();
    const res = await GET(request, params);
    const reader = res.body!.getReader();

    await vi.advanceTimersByTimeAsync(2000);
    const frame = await readFrame(reader);

    expect(frame?.startsWith("data: ")).toBe(true);
    expect(frame?.endsWith("\n\n")).toBe(true);
    const payload = JSON.parse(frame!.slice("data: ".length).trim());
    expect(payload).toEqual({
      entries: [
        {
          id: "e1",
          seq: 1,
          kind: "log",
          itemTypeKey: "mango",
          subjectUserId: "u1",
          actorUserId: "u1",
          clientEntryId: entry.clientEntryId,
          occurredAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      nextCursor: 1,
      hasMore: false,
    });
    expect(ledgerStore.readSince).toHaveBeenNthCalledWith(1, "s1", 0, 500);

    // The next tick polls from the advanced cursor, not from the original `after`.
    await vi.advanceTimersByTimeAsync(2000);
    expect(ledgerStore.readSince).toHaveBeenNthCalledWith(2, "s1", 1, 500);

    controller.abort();
  });

  it("does not overlap ticks when readSince is slower than the poll interval, and the cursor never regresses", async () => {
    asParticipant();
    const entry = {
      id: "e5",
      cycleId: "s1",
      seq: 5,
      kind: "log" as const,
      itemTypeKey: "mango",
      subjectUserId: "u1",
      actorUserId: "u1",
      voidsEntryId: null,
      clientEntryId: "33333333-3333-4333-8333-333333333333",
      occurredAt: new Date("2026-09-01T00:00:00Z"),
      createdAt: new Date("2026-09-01T00:00:00Z"),
    };

    // The first call never resolves on its own — held open to simulate a
    // readSince that takes longer than POLL_MS to come back.
    let resolveFirst!: (page: { entries: typeof entry[]; nextCursor: number; hasMore: boolean }) => void;
    const firstCall = new Promise<{ entries: typeof entry[]; nextCursor: number; hasMore: boolean }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(ledgerStore.readSince).mockReturnValueOnce(firstCall);
    vi.mocked(ledgerStore.readSince).mockResolvedValue({ entries: [], nextCursor: 5, hasMore: false });

    const { request, controller } = streamRequest();
    const res = await GET(request, params);
    const reader = res.body!.getReader();

    // First tick fires and starts the slow call.
    await vi.advanceTimersByTimeAsync(2000);
    expect(ledgerStore.readSince).toHaveBeenCalledTimes(1);

    // A second POLL_MS elapses while the first call is still in flight. With
    // the old setInterval implementation this fired a second, overlapping
    // readSince call racing on the same closed-over cursor; the self-scheduling
    // loop must not start a second call until the first one settles.
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ledgerStore.readSince).toHaveBeenCalledTimes(1);

    // Now the slow call finally resolves, landing the cursor at 5.
    resolveFirst({ entries: [entry], nextCursor: 5, hasMore: false });
    await vi.advanceTimersByTimeAsync(0);

    const frame = await readFrame(reader);
    expect(frame?.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(frame!.slice("data: ".length).trim());
    // Emitted exactly once — no duplicate/re-emitted frame from an overlapping tick.
    expect(payload.entries).toEqual([
      {
        id: "e5",
        seq: 5,
        kind: "log",
        itemTypeKey: "mango",
        subjectUserId: "u1",
        actorUserId: "u1",
        clientEntryId: entry.clientEntryId,
        occurredAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    expect(payload.nextCursor).toBe(5);

    // The next tick — now that the previous one has fully settled — must poll
    // from the advanced cursor (5), never regressing to a stale value.
    await vi.advanceTimersByTimeAsync(2000);
    expect(ledgerStore.readSince).toHaveBeenNthCalledWith(2, "s1", 5, 500);
    expect(ledgerStore.readSince).toHaveBeenCalledTimes(2);

    controller.abort();
  });

  it("starts from the after query param", async () => {
    asParticipant();
    vi.mocked(ledgerStore.readSince).mockResolvedValue({ entries: [], nextCursor: 7, hasMore: false });

    const { request, controller } = streamRequest("?after=7");
    const res = await GET(request, params);
    const reader = res.body!.getReader();

    await vi.advanceTimersByTimeAsync(2000);
    await readFrame(reader);

    expect(ledgerStore.readSince).toHaveBeenCalledWith("s1", 7, 500);
    controller.abort();
  });
});
