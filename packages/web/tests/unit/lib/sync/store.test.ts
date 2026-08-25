import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openSyncStore, toWireOp } from "@/lib/sync/store";
import { parseAppendOps } from "@/lib/appendOps";

const SESSION = "s1";
let store: Awaited<ReturnType<typeof openSyncStore>>;

beforeEach(async () => {
  store = await openSyncStore();
  await store.clearSession(SESSION);
});

describe("outbox", () => {
  it("starts empty with an empty aggregate", async () => {
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readAggregate(SESSION)).toEqual({ cursor: 0, counts: {} });
  });

  it("enqueues a log as pending and records it in myEntries", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    expect(entry.state).toBe("pending");
    expect(await store.readOutbox(SESSION)).toHaveLength(1);
    expect(await store.readMyEntries(SESSION)).toHaveLength(1);
  });

  // Undo case 1: nothing ever reaches the server.
  it("undo on a pending entry removes it from the outbox and leaves no tombstone", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.undo(SESSION, entry.clientEntryId);

    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  // Undo case 2: a real append that propagates to everyone.
  it("undo on a synced entry enqueues a void and marks the entry voiding", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);

    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe("void");
    expect(outbox[0]!.voidsClientEntryId).toBe(entry.clientEntryId);

    const mine = await store.readMyEntries(SESSION);
    expect(mine[0]!.state).toBe("voiding");
  });

  it("copies the target's item and subject onto a void op, for immediate display", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);

    const [op] = await store.readOutbox(SESSION);
    expect(op!.itemTypeKey).toBe("mango");
    expect(op!.subjectUserId).toBe("u1");
  });

  it("clears accepted and duplicate ops from the outbox on settle", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const b = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });
    await store.settleFlush(SESSION, {
      accepted: [a.clientEntryId], duplicates: [b.clientEntryId], rejected: [], cursor: 2,
    });
    expect(await store.readOutbox(SESSION)).toEqual([]);
    for (const entry of await store.readMyEntries(SESSION)) {
      expect(entry.state).toBe("synced");
    }
  });

  it("drops a rejected op rather than retrying it forever", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, {
      accepted: [], duplicates: [],
      rejected: [{ clientEntryId: entry.clientEntryId, reason: "cycle_closed", message: "closed" }],
      cursor: 0,
    });
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  it("survives a reopen — the outbox is durable, not in memory", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const reopened = await openSyncStore();
    expect(await reopened.readOutbox(SESSION)).toHaveLength(1);
  });

  it("keeps sessions isolated", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    expect(await store.readOutbox("s2")).toEqual([]);
  });

  it("settles an accepted/duplicate void by dropping the target from myEntries", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await store.settleFlush(SESSION, { accepted: [voidOp!.clientEntryId], duplicates: [], rejected: [], cursor: 2 });

    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  it("settles a rejected void by reverting the target from voiding back to synced", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await store.settleFlush(SESSION, {
      accepted: [], duplicates: [],
      rejected: [{ clientEntryId: voidOp!.clientEntryId, reason: "cycle_closed", message: "closed" }],
      cursor: 1,
    });

    expect(await store.readOutbox(SESSION)).toEqual([]);
    const mine = await store.readMyEntries(SESSION);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe("synced");
  });

  // Important 3: an already_voided rejection must not re-arm the undo button —
  // it can only ever produce another already_voided. Drop the target instead.
  it("settles an already_voided void rejection by dropping the target, not reviving it", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await store.settleFlush(SESSION, {
      accepted: [], duplicates: [],
      rejected: [{ clientEntryId: voidOp!.clientEntryId, reason: "already_voided", message: "already removed" }],
      cursor: 1,
    });

    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });
});

describe("beginFlush / abortFlush", () => {
  it("marks every returned op in-flight, durably", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const ops = await store.beginFlush(SESSION);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.inFlight).toBe(true);

    const stored = await store.readOutbox(SESSION);
    expect(stored[0]!.inFlight).toBe(true);
  });

  it("abortFlush clears the marker so a failed flush is retried, not stuck in flight", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.beginFlush(SESSION);
    await store.abortFlush(SESSION);

    const outbox = await store.readOutbox(SESSION);
    expect(outbox[0]!.inFlight).toBe(false);

    // Since it's no longer in flight, undo can go back to safely deleting it.
    await store.undo(SESSION, entry.clientEntryId);
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });
});

// Critical 2: undo racing an in-flight flush must never delete an op that may
// have already reached the server.
describe("undo racing an in-flight flush", () => {
  it("voids rather than deletes an in-flight log, and settling the accepted response doesn't resurrect it as synced", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const flushed = await store.beginFlush(SESSION);
    expect(flushed[0]!.inFlight).toBe(true);

    await store.undo(SESSION, entry.clientEntryId);

    // The original (in-flight) log op is still queued, alongside a new void.
    const outbox = await store.readOutbox(SESSION);
    expect(outbox.map((op) => op.kind).sort()).toEqual(["log", "void"]);
    expect((await store.readMyEntries(SESSION))[0]!.state).toBe("voiding");

    // The flush's response comes back accepted for the original log op — this
    // must not flip the entry back to "synced".
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    const mine = await store.readMyEntries(SESSION);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe("voiding");
  });

  it("drops the entry and the orphaned void when an in-flight log is rejected after a void was queued against it", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.beginFlush(SESSION); // marks the log in-flight
    await store.undo(SESSION, entry.clientEntryId); // races the flush: voids, doesn't delete

    expect(await store.readOutbox(SESSION)).toHaveLength(2); // the in-flight log + the new void

    await store.settleFlush(SESSION, {
      accepted: [], duplicates: [],
      rejected: [{ clientEntryId: entry.clientEntryId, reason: "unknown_target", message: "gone" }],
      cursor: 0,
    });

    // The log never existed server-side after all: drop it, and the void that
    // was queued against it — shipping that void would target nothing.
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });
});

describe("evictOp", () => {
  // Important 4: one bad op wedges every op queued behind it in the same
  // session's outbox (parseAppendOps 400s the whole batch). evictOp is the
  // recovery path.
  it("removes a specific op from the outbox so a wedged batch can recover", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const b = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });

    await store.evictOp(SESSION, a.clientEntryId);

    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.clientEntryId).toBe(b.clientEntryId);
    expect(await store.readMyEntries(SESSION)).toHaveLength(1);
  });

  it("evicting a void reverts its target back to synced rather than leaving it stuck voiding", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await store.evictOp(SESSION, voidOp!.clientEntryId);

    expect(await store.readOutbox(SESSION)).toEqual([]);
    const mine = await store.readMyEntries(SESSION);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe("synced");
  });
});

describe("enqueueLog validation", () => {
  // Important 4: a bad op must never even reach the outbox, since one
  // malformed op 400s the entire batch behind it.
  it("rejects an empty or whitespace itemTypeKey", async () => {
    await expect(store.enqueueLog(SESSION, { itemTypeKey: "", subjectUserId: "u1" })).rejects.toThrow();
    await expect(store.enqueueLog(SESSION, { itemTypeKey: "   ", subjectUserId: "u1" })).rejects.toThrow();
    expect(await store.readOutbox(SESSION)).toEqual([]);
  });

  it("rejects an empty subjectUserId", async () => {
    await expect(store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "" })).rejects.toThrow();
    expect(await store.readOutbox(SESSION)).toEqual([]);
  });

  it("trims a valid but padded itemTypeKey before storing it, so it can't 400 as unknown_item_type", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "  mango  ", subjectUserId: "u1" });
    expect(entry.itemTypeKey).toBe("mango");

    const [op] = await store.readOutbox(SESSION);
    expect(op!.itemTypeKey).toBe("mango");
  });
});

describe("aggregate cursor", () => {
  it("never moves the persisted cursor backwards", async () => {
    await store.writeAggregate(SESSION, { cursor: 5, counts: { mango: { u1: 3 } } });
    await store.writeAggregate(SESSION, { cursor: 3, counts: {} });

    expect(await store.readAggregate(SESSION)).toEqual({ cursor: 5, counts: { mango: { u1: 3 } } });
  });

  it("accepts a write that advances the cursor", async () => {
    await store.writeAggregate(SESSION, { cursor: 5, counts: {} });
    await store.writeAggregate(SESSION, { cursor: 7, counts: { mango: { u1: 1 } } });

    expect(await store.readAggregate(SESSION)).toEqual({ cursor: 7, counts: { mango: { u1: 1 } } });
  });

  // Critical 1: writeAggregate must be atomic, not check-then-act — two
  // concurrent writers (e.g. a cold-open snapshot and an SSE push) racing on
  // the same session must still resolve to the max cursor, regardless of
  // which one happened to issue its write first.
  it("resolves two concurrent writes to the max cursor even when the higher cursor is issued first", async () => {
    const higher = store.writeAggregate(SESSION, { cursor: 20, counts: {} });
    const lower = store.writeAggregate(SESSION, { cursor: 15, counts: {} });
    await Promise.all([higher, lower]);

    expect((await store.readAggregate(SESSION)).cursor).toBe(20);
  });
});

describe("wire compatibility", () => {
  it("projects a log and a void op into a batch the real parser accepts", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);

    // Simulate a fresh log queued alongside the void from above, so the batch
    // has one of each kind.
    const another = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });
    const outbox = await store.readOutbox(SESSION);
    expect(outbox.map((op) => op.kind).sort()).toEqual(["log", "void"]);
    expect(outbox.some((op) => op.clientEntryId === another.clientEntryId)).toBe(true);

    const result = parseAppendOps({ ops: outbox.map(toWireOp) });
    expect(result).toMatchObject({ ok: true });
  });
});
