import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openSyncStore, type SyncStore } from "@/lib/sync/store";
import { parseAppendOps, MAX_BATCH } from "@/lib/appendOps";
import type { EntryJson } from "@/lib/ledgerJson";
import {
  flushOutbox,
  pullDelta,
  reviveEntry,
  displayedAggregate,
  dropConfirmed,
  type SyncState,
} from "@/lib/sync/client";

const SESSION = "s1";
const SUBJECT = "member-1";

let store: SyncStore;

beforeEach(async () => {
  store = await openSyncStore();
  await store.clearSession(SESSION);
});

/** Minimal fetch stand-in: a fixed sequence of responses, one per call. */
function fetchSequence(...responses: Array<Response | (() => Promise<Response>)>): typeof fetch {
  let i = 0;
  return (async () => {
    const next = responses[i++];
    if (next === undefined) throw new Error("fetchSequence: exhausted");
    return typeof next === "function" ? next() : next;
  }) as unknown as typeof fetch;
}

function fetchThrows(message: string): typeof fetch {
  return (async () => {
    throw new TypeError(message);
  }) as unknown as typeof fetch;
}

describe("flushOutbox", () => {
  it("does nothing and makes no request when the outbox is empty", async () => {
    const fetchImpl = fetchSequence();
    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result).toEqual({ status: "empty" });
  });

  it("a 200 with mixed accepted/rejected settles both and clears the outbox", async () => {
    const accepted = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });
    const rejected = await store.enqueueLog(SESSION, { itemTypeKey: "papaya", subjectUserId: SUBJECT });

    const fetchImpl = fetchSequence(
      Response.json({
        cursor: 1,
        accepted: [accepted.clientEntryId],
        duplicates: [],
        rejected: [{ clientEntryId: rejected.clientEntryId, reason: "unknown_item_type", message: "nope" }],
      }),
    );

    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result.status).toBe("flushed");

    expect(await store.readOutbox(SESSION)).toEqual([]);
    const mine = await store.readMyEntries(SESSION);
    // Accepted log moved to synced; rejected log dropped entirely.
    expect(mine).toHaveLength(1);
    expect(mine[0]!.clientEntryId).toBe(accepted.clientEntryId);
    expect(mine[0]!.state).toBe("synced");
  });

  it("an HTTP 400 on a malformed batch leaves the claim in place and never re-sends it", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });

    const fetchImpl = fetchSequence(new Response(null, { status: 400 }));
    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result.status).toBe("malformed");

    // The op is still there (never deleted, never settled) and still claimed —
    // a second flush call must NOT re-send it, i.e. it must see nothing to claim.
    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.attemptId).toBeDefined();

    const second = await flushOutbox(store, SESSION, fetchSequence());
    expect(second).toEqual({ status: "empty" });
  });

  it("a request that never returns aborts the claim so the same ops are retried next time", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });

    const failing = fetchThrows("network down");
    const first = await flushOutbox(store, SESSION, failing);
    expect(first).toEqual({ status: "retry" });

    // Released back to unclaimed: still present, no attemptId.
    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.attemptId).toBeUndefined();

    // Next attempt succeeds and picks the same op back up.
    const succeeding = fetchSequence(
      Response.json({ cursor: 1, accepted: [entry.clientEntryId], duplicates: [], rejected: [] }),
    );
    const second = await flushOutbox(store, SESSION, succeeding);
    expect(second.status).toBe("flushed");
    expect(await store.readOutbox(SESSION)).toEqual([]);
  });

  it("a non-400 error response (e.g. 500) also aborts and retries rather than settling", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });

    const fetchImpl = fetchSequence(new Response(null, { status: 500 }));
    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result).toEqual({ status: "retry" });

    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.attemptId).toBeUndefined();
  });

  it("posts a body the real parseAppendOps accepts — envelope shape and the no-subjectUserId rule", async () => {
    // Get one log accepted and synced first, so undoing it queues a real void
    // op (not a delete) — gives the batch below one op of each kind.
    const synced = await store.enqueueLog(SESSION, { itemTypeKey: "papaya", subjectUserId: SUBJECT });
    const firstAttempt = await store.beginFlush(SESSION);
    await store.settleFlush(SESSION, firstAttempt.attemptId, {
      cursor: 1,
      accepted: [synced.clientEntryId],
      duplicates: [],
      rejected: [],
    });
    await store.undo(SESSION, synced.clientEntryId); // synced -> enqueues a void
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT }); // a fresh pending log

    let capturedBody: unknown;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return Response.json({ cursor: 2, accepted: [], duplicates: [], rejected: [] });
    }) as unknown as typeof fetch;

    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result.status).toBe("flushed");
    expect(capturedBody).toBeDefined();

    const parsed = parseAppendOps(capturedBody);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // A void with no itemTypeKey/subjectUserId leaking through, and no log
      // carrying subjectUserId either — toWireOp's whitelist held under the
      // real server parser, not just our own assumptions about its shape.
      expect(parsed.value.some((op) => op.kind === "void")).toBe(true);
      for (const op of parsed.value) {
        expect("subjectUserId" in op).toBe(false);
      }
    }
  });

  it("a 200 whose body cannot be parsed as JSON aborts and retries", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });

    const fetchImpl = fetchSequence(new Response("not json", { status: 200 }));
    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result).toEqual({ status: "retry" });

    const outbox = await store.readOutbox(SESSION);
    expect(outbox[0]!.attemptId).toBeUndefined();
  });

  it("chunks a claim bigger than MAX_BATCH into multiple requests and settles every op", async () => {
    const count = MAX_BATCH + 1;
    for (let i = 0; i < count; i++) {
      await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });
    }

    const batchSizes: number[] = [];
    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(init!.body as string) as { ops: { clientEntryId: string }[] };
      batchSizes.push(body.ops.length);
      return Response.json({
        cursor: calls,
        accepted: body.ops.map((op) => op.clientEntryId),
        duplicates: [],
        rejected: [],
      });
    }) as unknown as typeof fetch;

    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result.status).toBe("flushed");
    expect(calls).toBe(2); // MAX_BATCH + 1 split into two requests
    expect(batchSizes).toEqual([MAX_BATCH, 1]);
    if (result.status === "flushed") {
      expect(result.outcome.accepted).toHaveLength(count);
    }

    expect(await store.readOutbox(SESSION)).toEqual([]);
    const mine = await store.readMyEntries(SESSION);
    expect(mine).toHaveLength(count);
    expect(mine.every((e) => e.state === "synced")).toBe(true);
  }, 30_000);

  it("a malformed second batch leaves it (and nothing behind it) claimed, while the first batch's settle stands", async () => {
    const count = MAX_BATCH + 5;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: SUBJECT });
      ids.push(entry.clientEntryId);
    }

    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(init!.body as string) as { ops: { clientEntryId: string }[] };
      if (calls === 1) {
        return Response.json({
          cursor: 1,
          accepted: body.ops.map((op) => op.clientEntryId),
          duplicates: [],
          rejected: [],
        });
      }
      return new Response(null, { status: 400 });
    }) as unknown as typeof fetch;

    const result = await flushOutbox(store, SESSION, fetchImpl);
    expect(result.status).toBe("malformed");
    expect(calls).toBe(2);
    if (result.status === "malformed") {
      expect(result.outcome?.accepted).toHaveLength(MAX_BATCH);
    }

    // First batch's ops are gone (settled); the second batch's 5 ops are
    // still there, still claimed, never resent by a follow-up flush.
    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(5);
    expect(outbox.every((op) => op.attemptId !== undefined)).toBe(true);

    const second = await flushOutbox(store, SESSION, fetchSequence());
    expect(second).toEqual({ status: "empty" });
  }, 30_000);
});

describe("pullDelta", () => {
  const emptyAgg = { cursor: 0, counts: {} };

  function pageResponse(entries: EntryJson[], nextCursor: number, hasMore: boolean): Response {
    return Response.json({ entries, nextCursor, hasMore });
  }

  it("drains multiple pages while hasMore is true and stops on the first false", async () => {
    const page1Entry: EntryJson = {
      id: "e1",
      seq: 1,
      kind: "log",
      itemTypeKey: "mango",
      subjectUserId: SUBJECT,
      actorUserId: SUBJECT,
      clientEntryId: "c1",
      occurredAt: new Date().toISOString(),
    };
    const page2Entry: EntryJson = {
      id: "e2",
      seq: 2,
      kind: "log",
      itemTypeKey: "papaya",
      subjectUserId: SUBJECT,
      actorUserId: SUBJECT,
      clientEntryId: "c2",
      occurredAt: new Date().toISOString(),
    };

    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return pageResponse([page1Entry], 1, true);
      return pageResponse([page2Entry], 2, false);
    }) as unknown as typeof fetch;

    const result = await pullDelta(SESSION, emptyAgg, [], fetchImpl);
    expect(calls).toBe(2);
    expect(result.aggregate.cursor).toBe(2);
    expect(result.aggregate.counts[SUBJECT]?.mango).toBe(1);
    expect(result.aggregate.counts[SUBJECT]?.papaya).toBe(1);
  });

  it("prunes a pending op whose clientEntryId shows up in the drained page (dropConfirmed wiring)", async () => {
    const entry: EntryJson = {
      id: "e1",
      seq: 1,
      kind: "log",
      itemTypeKey: "mango",
      subjectUserId: SUBJECT,
      actorUserId: SUBJECT,
      clientEntryId: "pending-1",
      occurredAt: new Date().toISOString(),
    };
    const fetchImpl = (async () => pageResponse([entry], 1, false)) as unknown as typeof fetch;

    const pending: SyncState["pending"] = [
      {
        clientEntryId: "pending-1",
        sessionId: SESSION,
        kind: "log",
        itemTypeKey: "mango",
        subjectUserId: SUBJECT,
        occurredAt: new Date().toISOString(),
      },
    ];

    const result = await pullDelta(SESSION, emptyAgg, pending, fetchImpl);
    expect(result.pending).toEqual([]);
  });

  it("stops and returns what it has so far when a page's fetch throws", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return pageResponse(
          [
            {
              id: "e1",
              seq: 1,
              kind: "log",
              itemTypeKey: "mango",
              subjectUserId: SUBJECT,
              actorUserId: SUBJECT,
              clientEntryId: "c1",
              occurredAt: new Date().toISOString(),
            },
          ],
          1,
          true, // claims more, but the next fetch will throw
        );
      }
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    const result = await pullDelta(SESSION, emptyAgg, [], fetchImpl);
    expect(calls).toBe(2);
    expect(result.aggregate.cursor).toBe(1); // page 1's progress is kept
  });

  it("stops on a non-ok response without throwing", async () => {
    const fetchImpl = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const result = await pullDelta(SESSION, emptyAgg, [], fetchImpl);
    expect(result).toEqual({ aggregate: emptyAgg, pending: [] });
  });

  it("stops on an unparseable body without throwing", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const result = await pullDelta(SESSION, emptyAgg, [], fetchImpl);
    expect(result).toEqual({ aggregate: emptyAgg, pending: [] });
  });
});

describe("reviveEntry", () => {
  it("parses occurredAt into a Date and fills in the fields the wire shape omits", () => {
    const entry = reviveEntry(
      {
        id: "srv-1",
        seq: 5,
        kind: "log",
        itemTypeKey: "mango",
        subjectUserId: "u1",
        actorUserId: "u1",
        clientEntryId: "c1",
        occurredAt: "2026-08-25T00:00:00.000Z",
      },
      SESSION,
    );
    expect(entry.cycleId).toBe(SESSION);
    expect(entry.seq).toBe(5);
    expect(entry.occurredAt).toBeInstanceOf(Date);
    expect(entry.occurredAt.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(entry.createdAt).toBeInstanceOf(Date);
    expect(entry.voidsEntryId).toBeNull();
  });
});

describe("dropConfirmed", () => {
  it("removes a pending op whose clientEntryId just arrived in a delta page", () => {
    const pending: SyncState["pending"] = [
      {
        clientEntryId: "c1",
        sessionId: SESSION,
        kind: "log",
        itemTypeKey: "mango",
        subjectUserId: SUBJECT,
        occurredAt: new Date().toISOString(),
      },
      {
        clientEntryId: "c2",
        sessionId: SESSION,
        kind: "log",
        itemTypeKey: "papaya",
        subjectUserId: SUBJECT,
        occurredAt: new Date().toISOString(),
      },
    ];
    const arriving = [reviveEntry(
      {
        id: "srv-1",
        seq: 1,
        kind: "log",
        itemTypeKey: "mango",
        subjectUserId: SUBJECT,
        actorUserId: SUBJECT,
        clientEntryId: "c1",
        occurredAt: new Date().toISOString(),
      },
      SESSION,
    )];

    const result = dropConfirmed(pending, arriving);
    expect(result.map((op) => op.clientEntryId)).toEqual(["c2"]);
  });

  it("is a no-op when nothing pending or nothing arriving", () => {
    expect(dropConfirmed([], [])).toEqual([]);
  });
});

describe("displayedAggregate", () => {
  it("folds pending outbox ops on top of the stored aggregate without mutating it", () => {
    const state: SyncState = {
      aggregate: { cursor: 3, counts: { [SUBJECT]: { mango: 2 } } },
      pending: [
        {
          clientEntryId: "pending-1",
          sessionId: SESSION,
          kind: "log",
          itemTypeKey: "mango",
          subjectUserId: SUBJECT,
          occurredAt: new Date().toISOString(),
        },
      ],
      degraded: false,
      online: true,
    };

    const displayed = displayedAggregate(state, SUBJECT);
    expect(displayed.counts[SUBJECT]?.mango).toBe(3);
    // The stored aggregate itself is untouched.
    expect(state.aggregate.counts[SUBJECT]?.mango).toBe(2);
    // Cursor stays put so the next real delta isn't skipped.
    expect(displayed.cursor).toBe(3);
  });

  it("shows a pending void as an immediate decrement", () => {
    const state: SyncState = {
      aggregate: { cursor: 3, counts: { [SUBJECT]: { mango: 2 } } },
      pending: [
        {
          clientEntryId: "void-1",
          sessionId: SESSION,
          kind: "void",
          itemTypeKey: "mango",
          subjectUserId: SUBJECT,
          voidsClientEntryId: "some-earlier-entry",
          occurredAt: new Date().toISOString(),
        },
      ],
      degraded: false,
      online: true,
    };

    const displayed = displayedAggregate(state, SUBJECT);
    expect(displayed.counts[SUBJECT]?.mango).toBe(1);
  });
});
