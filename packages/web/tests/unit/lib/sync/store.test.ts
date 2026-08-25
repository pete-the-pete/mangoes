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
      rejected: [{ clientEntryId: voidOp!.clientEntryId, reason: "already_voided", message: "already removed" }],
      cursor: 1,
    });

    expect(await store.readOutbox(SESSION)).toEqual([]);
    const mine = await store.readMyEntries(SESSION);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.state).toBe("synced");
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
