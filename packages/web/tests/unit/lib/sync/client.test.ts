import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openSyncStore, type SyncStore } from "@/lib/sync/store";
import { parseAppendOps } from "@/lib/appendOps";
import {
  flushOutbox,
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
