import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openSyncStore, toWireOp, type FlushOutcome } from "@/lib/sync/store";
import { parseAppendOps } from "@/lib/appendOps";

const SESSION = "s1";
let store: Awaited<ReturnType<typeof openSyncStore>>;

beforeEach(async () => {
  store = await openSyncStore();
  await store.clearSession(SESSION);
});

/**
 * Claims every currently-unclaimed op in the session via a fresh attempt and
 * settles it with the given outcome — the common "enqueue, then settle" shape
 * most tests below only care about at the outcome level, not the attempt
 * bookkeeping itself (that's covered explicitly under "flush attempts").
 */
async function settle(outcome: FlushOutcome): Promise<void> {
  const { attemptId } = await store.beginFlush(SESSION);
  await store.settleFlush(SESSION, attemptId, outcome);
}

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
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
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
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);

    const [op] = await store.readOutbox(SESSION);
    expect(op!.itemTypeKey).toBe("mango");
    expect(op!.subjectUserId).toBe("u1");
  });

  it("clears accepted and duplicate ops from the outbox on settle", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const b = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });
    await settle({ accepted: [a.clientEntryId], duplicates: [b.clientEntryId], rejected: [], cursor: 2 });
    expect(await store.readOutbox(SESSION)).toEqual([]);
    for (const entry of await store.readMyEntries(SESSION)) {
      expect(entry.state).toBe("synced");
    }
  });

  it("drops a rejected op rather than retrying it forever", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await settle({
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
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await settle({ accepted: [voidOp!.clientEntryId], duplicates: [], rejected: [], cursor: 2 });

    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  it("settles a rejected void by reverting the target from voiding back to synced", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await settle({
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
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);
    const [voidOp] = await store.readOutbox(SESSION);

    await settle({
      accepted: [], duplicates: [],
      rejected: [{ clientEntryId: voidOp!.clientEntryId, reason: "already_voided", message: "already removed" }],
      cursor: 1,
    });

    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });
});

describe("flush attempts", () => {
  it("beginFlush claims every unclaimed op with a fresh attemptId, durably", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attempt = await store.beginFlush(SESSION);
    expect(attempt.ops).toHaveLength(1);
    expect(attempt.ops[0]!.attemptId).toBe(attempt.attemptId);

    const stored = await store.readOutbox(SESSION);
    expect(stored[0]!.attemptId).toBe(attempt.attemptId);
  });

  it("beginFlush returns an empty claim, not an error, when there's nothing new to claim", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.beginFlush(SESSION); // claims the only op

    const second = await store.beginFlush(SESSION);
    expect(second.ops).toEqual([]);
    expect(typeof second.attemptId).toBe("string");
  });

  it("abortFlush releases only its own attempt's ops so a failed flush is retried, not stuck claimed", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attempt = await store.beginFlush(SESSION);
    await store.abortFlush(SESSION, attempt.attemptId);

    const outbox = await store.readOutbox(SESSION);
    expect(outbox[0]!.attemptId).toBeUndefined();

    // Since it's unclaimed again, undo can go back to safely deleting it.
    await store.undo(SESSION, entry.clientEntryId);
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  // Important finding, fix round 2: abortFlush must be scoped to one attempt,
  // not session-wide — otherwise aborting a failed attempt A can un-claim ops
  // a second, still-live attempt B already owns, reopening the exact hole
  // Critical 2 closed (undo could then delete an op that may have reached the
  // server).
  it("keeps a second attempt's claimed ops in-flight when an unrelated first attempt aborts", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attemptA = await store.beginFlush(SESSION);
    expect(attemptA.ops.map((op) => op.clientEntryId)).toEqual([a.clientEntryId]);

    // A new op arrives after A's claim closed over the outbox — it's
    // unclaimed, so a second attempt can pick it up independently.
    const b = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });
    const attemptB = await store.beginFlush(SESSION);
    expect(attemptB.ops.map((op) => op.clientEntryId)).toEqual([b.clientEntryId]);

    await store.abortFlush(SESSION, attemptA.attemptId);

    const outbox = await store.readOutbox(SESSION);
    const aOp = outbox.find((op) => op.clientEntryId === a.clientEntryId)!;
    const bOp = outbox.find((op) => op.clientEntryId === b.clientEntryId)!;
    expect(aOp.attemptId).toBeUndefined(); // released by A's abort
    expect(bOp.attemptId).toBe(attemptB.attemptId); // untouched — still B's

    // And undo on b, still claimed by the live attempt B, must void rather
    // than delete — it may already have reached the server.
    await store.undo(SESSION, b.clientEntryId);
    const afterUndo = await store.readOutbox(SESSION);
    expect(afterUndo.some((op) => op.kind === "void" && op.voidsClientEntryId === b.clientEntryId)).toBe(true);
    const mine = await store.readMyEntries(SESSION);
    expect(mine.find((e) => e.clientEntryId === b.clientEntryId)!.state).toBe("voiding");
  });

  it("settleFlush ignores a stale response whose op has since been reclaimed by a different, live attempt", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attemptA = await store.beginFlush(SESSION);

    // A's response never arrives; abandoned and released, then reclaimed by a
    // fresh attempt C. A's (now-stale) response finally shows up — settling
    // under A's id must not touch what C currently owns.
    await store.abortFlush(SESSION, attemptA.attemptId);
    const attemptC = await store.beginFlush(SESSION);
    expect(attemptC.ops.map((op) => op.clientEntryId)).toEqual([a.clientEntryId]);

    await store.settleFlush(SESSION, attemptA.attemptId, {
      accepted: [a.clientEntryId], duplicates: [], rejected: [], cursor: 1,
    });

    // Still owned by C, untouched by the stale settle under A.
    const outbox = await store.readOutbox(SESSION);
    expect(outbox[0]!.attemptId).toBe(attemptC.attemptId);
    expect((await store.readMyEntries(SESSION))[0]!.state).toBe("pending");
  });

  it("settleFlush ignores an outcome id whose op is owned by a concurrently live second attempt", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attemptA = await store.beginFlush(SESSION);

    // A second op arrives and gets claimed by a second, still-live attempt
    // while A is genuinely in flight (no abort involved on either side).
    const b = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });
    const attemptB = await store.beginFlush(SESSION);
    expect(attemptB.ops.map((op) => op.clientEntryId)).toEqual([b.clientEntryId]);

    // A's response arrives and, through a caller bug, lists B's op id too —
    // settling under A's attemptId must not touch it; only A's own op (a).
    await store.settleFlush(SESSION, attemptA.attemptId, {
      accepted: [a.clientEntryId, b.clientEntryId], duplicates: [], rejected: [], cursor: 1,
    });

    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.clientEntryId).toBe(b.clientEntryId);
    expect(outbox[0]!.attemptId).toBe(attemptB.attemptId);

    const mine = await store.readMyEntries(SESSION);
    expect(mine.find((e) => e.clientEntryId === a.clientEntryId)!.state).toBe("synced");
    expect(mine.find((e) => e.clientEntryId === b.clientEntryId)!.state).toBe("pending");
  });
});

// Critical 2: undo racing an in-flight flush must never delete an op that may
// have already reached the server.
describe("undo racing an in-flight flush", () => {
  it("voids rather than deletes a claimed log, and settling the accepted response doesn't resurrect it as synced", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attempt = await store.beginFlush(SESSION);
    expect(attempt.ops[0]!.attemptId).toBe(attempt.attemptId);

    await store.undo(SESSION, entry.clientEntryId);

    // The original (claimed) log op is still queued, alongside a new void.
    const outbox = await store.readOutbox(SESSION);
    expect(outbox.map((op) => op.kind).sort()).toEqual(["log", "void"]);
    expect((await store.readMyEntries(SESSION))[0]!.state).toBe("voiding");

    // The flush's response comes back accepted for the original log op — this
    // must not flip the entry back to "synced".
    await store.settleFlush(SESSION, attempt.attemptId, {
      accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1,
    });
    const mine = await store.readMyEntries(SESSION);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe("voiding");
  });

  it("drops the entry and the orphaned void when a claimed log is rejected after a void was queued against it", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const attempt = await store.beginFlush(SESSION); // claims the log
    await store.undo(SESSION, entry.clientEntryId); // races the flush: voids, doesn't delete

    expect(await store.readOutbox(SESSION)).toHaveLength(2); // the claimed log + the new void

    await store.settleFlush(SESSION, attempt.attemptId, {
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
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
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
    await settle({ accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
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
