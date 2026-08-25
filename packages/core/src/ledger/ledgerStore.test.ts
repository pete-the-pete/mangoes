import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createPostgresLedgerStore } from "./ledgerStore.js";
import { createPostgresCycleStore } from "../cycles/cycleStore.js";
import { createPostgresCohortStore } from "../cohorts/cohortStore.js";
import { runMigrations } from "../db/migrate.js";
import { UNTAGGED, type AppendContext } from "./types.js";
import { emptyAggregate, foldEntries } from "./fold.js";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see README, then `docker compose up -d`");
}
const { hostname } = new URL(connectionString);
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  throw new Error(
    `Refusing to run destructive tests against a non-local database (${hostname}). ` +
      "These tests DELETE FROM cohorts.",
  );
}

const pool = new Pool({ connectionString });
const cohortStore = createPostgresCohortStore(pool);
const cycleStore = createPostgresCycleStore(pool);
const store = createPostgresLedgerStore(pool);

const MEMBER: AppendContext = {
  actorUserId: "u1",
  canVoidOthers: false,
  canWriteClosed: false,
  canWriteForOthers: false,
};
const ADMIN: AppendContext = {
  actorUserId: "a1",
  canVoidOthers: true,
  canWriteClosed: true,
  canWriteForOthers: true,
};

beforeAll(async () => {
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO item_types (key, emoji, label, position)
     VALUES ('mango', '🥭', 'Mango', 0), ('taco', '🌮', 'Taco', 1)
     ON CONFLICT (key) DO NOTHING`,
  );
});

beforeEach(async () => {
  await pool.query("DELETE FROM cohorts");
});

afterAll(async () => {
  await pool.query("DELETE FROM cohorts");
  await pool.query("DELETE FROM item_types WHERE key IN ('mango', 'taco')");
  await pool.end();
});

async function makeCycle() {
  const cohort = await cohortStore.createCohort({ name: "Cabo", createdBy: "a1" });
  return cycleStore.createCycle({
    cohortId: cohort.id,
    name: "Day 3",
    startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-08T00:00:00Z"),
    itemTypeKeys: ["mango", "taco"],
    participantIds: ["u1", "u2"],
    createdBy: "a1",
  });
}

function log(itemTypeKey = "mango") {
  return {
    clientEntryId: randomUUID(),
    kind: "log" as const,
    itemTypeKey,
    occurredAt: new Date(),
  };
}

function voidOf(targetClientEntryId: string) {
  return {
    clientEntryId: randomUUID(),
    kind: "void" as const,
    voidsClientEntryId: targetClientEntryId,
    occurredAt: new Date(),
  };
}

describe("createPostgresLedgerStore", () => {
  it("assigns a gapless sequence starting at 1", async () => {
    const cycle = await makeCycle();
    const result = await store.append(cycle.id, MEMBER, [log(), log(), log()]);
    expect(result.accepted).toHaveLength(3);
    expect(result.cursor).toBe(3);

    const page = await store.readSince(cycle.id, 0, 100);
    expect(page.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("treats a replayed client_entry_id as a duplicate, not an error", async () => {
    const cycle = await makeCycle();
    const op = log();
    await store.append(cycle.id, MEMBER, [op]);
    const second = await store.append(cycle.id, MEMBER, [op]);

    expect(second.duplicates).toEqual([op.clientEntryId]);
    expect(second.accepted).toEqual([]);
    // The replay must not consume a sequence.
    expect(second.cursor).toBe(1);
  });

  it("credits the actor by default and the group when subject is explicitly null", async () => {
    const cycle = await makeCycle();
    await store.append(cycle.id, MEMBER, [log()]);
    await store.append(cycle.id, ADMIN, [{ ...log(), subjectUserId: null }]);

    const aggregate = await store.snapshot(cycle.id);
    expect(aggregate.counts["u1"]?.["mango"]).toBe(1);
    expect(aggregate.counts[UNTAGGED]?.["mango"]).toBe(1);
  });

  it("rejects a member logging for someone else", async () => {
    const cycle = await makeCycle();
    const result = await store.append(cycle.id, MEMBER, [{ ...log(), subjectUserId: "u2" }]);
    expect(result.rejected[0]?.reason).toBe("not_your_entry");
    expect(result.cursor).toBe(0);
  });

  it("voids by client id, copying the target's item and subject", async () => {
    const cycle = await makeCycle();
    const target = log();
    await store.append(cycle.id, MEMBER, [target]);
    await store.append(cycle.id, MEMBER, [voidOf(target.clientEntryId)]);

    const page = await store.readSince(cycle.id, 0, 100);
    const voidRow = page.entries[1]!;
    expect(voidRow.kind).toBe("void");
    expect(voidRow.itemTypeKey).toBe("mango");
    expect(voidRow.subjectUserId).toBe("u1");
    expect(voidRow.voidsEntryId).toBe(page.entries[0]!.id);

    const aggregate = await store.snapshot(cycle.id);
    expect(aggregate.counts["u1"]?.["mango"] ?? 0).toBe(0);
  });

  it("rejects a member voiding someone else's entry", async () => {
    const cycle = await makeCycle();
    const target = log();
    await store.append(cycle.id, { ...MEMBER, actorUserId: "u2" }, [target]);
    const result = await store.append(cycle.id, MEMBER, [voidOf(target.clientEntryId)]);
    expect(result.rejected[0]?.reason).toBe("not_your_entry");
  });

  it("rejects voiding the same entry twice", async () => {
    const cycle = await makeCycle();
    const target = log();
    await store.append(cycle.id, MEMBER, [target]);
    await store.append(cycle.id, MEMBER, [voidOf(target.clientEntryId)]);
    const again = await store.append(cycle.id, MEMBER, [voidOf(target.clientEntryId)]);
    expect(again.rejected[0]?.reason).toBe("already_voided");
  });

  it("rejects an unknown void target but still applies the rest of the batch", async () => {
    const cycle = await makeCycle();
    const good = log();
    const result = await store.append(cycle.id, MEMBER, [voidOf(randomUUID()), good]);
    expect(result.rejected[0]?.reason).toBe("unknown_target");
    expect(result.accepted).toEqual([good.clientEntryId]);
  });

  it("rejects an item type that is not in the catalog", async () => {
    const cycle = await makeCycle();
    const result = await store.append(cycle.id, MEMBER, [log("not-a-real-item")]);
    expect(result.rejected[0]?.reason).toBe("unknown_item_type");
    expect(result.cursor).toBe(0);
  });

  it("rejects a member write to a closed cycle and allows an admin's", async () => {
    const cycle = await makeCycle();
    await cycleStore.closeCycle(cycle.id, "a1");

    const denied = await store.append(cycle.id, MEMBER, [log()]);
    expect(denied.rejected[0]?.reason).toBe("cycle_closed");

    const allowed = await store.append(cycle.id, ADMIN, [log()]);
    expect(allowed.accepted).toHaveLength(1);
  });

  it("pages deltas and reports hasMore", async () => {
    const cycle = await makeCycle();
    await store.append(cycle.id, MEMBER, [log(), log(), log()]);

    const first = await store.readSince(cycle.id, 0, 2);
    expect(first.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.nextCursor).toBe(2);
    expect(first.hasMore).toBe(true);

    const second = await store.readSince(cycle.id, first.nextCursor, 2);
    expect(second.entries.map((e) => e.seq)).toEqual([3]);
    expect(second.hasMore).toBe(false);
  });

  it("separates counts per item type", async () => {
    const cycle = await makeCycle();
    await store.append(cycle.id, MEMBER, [log("mango"), log("taco"), log("taco")]);
    const aggregate = await store.snapshot(cycle.id);
    expect(aggregate.counts["u1"]?.["mango"]).toBe(1);
    expect(aggregate.counts["u1"]?.["taco"]).toBe(2);
    expect(aggregate.cursor).toBe(3);
  });

  it("returns an empty aggregate for a cycle with no entries", async () => {
    const cycle = await makeCycle();
    expect(await store.snapshot(cycle.id)).toEqual({ cursor: 0, counts: {} });
  });

  it("lists a subject's own entries in sequence order", async () => {
    const cycle = await makeCycle();
    const mine = log();
    await store.append(cycle.id, MEMBER, [mine]);
    await store.append(cycle.id, { ...MEMBER, actorUserId: "u2" }, [log()]);

    const entries = await store.listEntriesForSubject(cycle.id, "u1");
    expect(entries.map((e) => e.clientEntryId)).toEqual([mine.clientEntryId]);
  });

  it("finds an entry by server id, for the admin void path", async () => {
    const cycle = await makeCycle();
    const op = log();
    await store.append(cycle.id, MEMBER, [op]);
    const [entry] = (await store.readSince(cycle.id, 0, 10)).entries;

    const found = await store.getEntryById(cycle.id, entry!.id);
    expect(found?.clientEntryId).toBe(op.clientEntryId);
    expect(await store.getEntryById(cycle.id, randomUUID())).toBeUndefined();
  });

  // snapshot() computes counts in SQL for a cold open; every client computes the
  // same counts by folding deltas. Nothing forces those two implementations to
  // agree, and if they drift a member's leaderboard quietly depends on whether
  // they opened cold or caught up — which is exactly the kind of bug that never
  // shows up as an error. This pins them together.
  it("agrees with foldEntries over the same history", async () => {
    const cycle = await makeCycle();
    const mine = log("mango");
    await store.append(cycle.id, MEMBER, [mine, log("taco")]);
    await store.append(cycle.id, { ...MEMBER, actorUserId: "u2" }, [log("mango"), log("mango")]);
    await store.append(cycle.id, ADMIN, [{ ...log("taco"), subjectUserId: null }]);
    await store.append(cycle.id, ADMIN, [{ ...log("mango"), subjectUserId: "u2" }]);
    await store.append(cycle.id, MEMBER, [voidOf(mine.clientEntryId)]);

    const fromSql = await store.snapshot(cycle.id);
    const all = await store.readSince(cycle.id, 0, 1000);
    const fromFold = foldEntries(emptyAggregate(), all.entries);

    expect(fromFold.counts).toEqual(fromSql.counts);
    expect(fromFold.cursor).toBe(fromSql.cursor);
    // Not a vacuous pass: the history above is meant to exercise every branch.
    expect(fromSql.counts["u1"]?.["mango"]).toBe(0);
    expect(fromSql.counts["u2"]?.["mango"]).toBe(3);
    expect(fromSql.counts[UNTAGGED]?.["taco"]).toBe(1);
  });

  // The test that justifies the entire design. Without it, the row-lock argument
  // is an assertion rather than a fact, and a future refactor to bigserial passes
  // every other test in this file while silently losing entries.
  it("keeps the sequence gapless and commit-ordered under concurrent appends", async () => {
    const cycle = await makeCycle();
    const BATCHES = 20;

    await Promise.all(
      Array.from({ length: BATCHES }, () => store.append(cycle.id, MEMBER, [log()])),
    );

    const page = await store.readSince(cycle.id, 0, 1000);
    const seqs = page.entries.map((e) => e.seq);
    expect(seqs).toHaveLength(BATCHES);
    expect(seqs).toEqual(Array.from({ length: BATCHES }, (_, i) => i + 1));

    // Commit order matches sequence order: created_at is non-decreasing across seq.
    const times = page.entries.map((e) => e.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
