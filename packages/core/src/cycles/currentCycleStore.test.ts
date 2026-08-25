import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createPostgresCurrentCycleStore } from "./currentCycleStore.js";
import { createPostgresCycleStore } from "./cycleStore.js";
import { createPostgresCohortStore } from "../cohorts/cohortStore.js";
import { runMigrations } from "../db/migrate.js";

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
const store = createPostgresCurrentCycleStore(pool, (id) => cycleStore.getCycle(id));

beforeAll(async () => {
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO item_types (key, emoji, label, position)
     VALUES ('mango', '🥭', 'Mango', 0)
     ON CONFLICT (key) DO NOTHING`,
  );
});

beforeEach(async () => {
  await pool.query("DELETE FROM cohorts");
  await pool.query("DELETE FROM user_current_cycle");
});

afterAll(async () => {
  await pool.query("DELETE FROM cohorts");
  await pool.query("DELETE FROM user_current_cycle");
  await pool.query("DELETE FROM item_types WHERE key = 'mango'");
  await pool.end();
});

async function makeCycle(participantIds = ["u1", "u2"]) {
  const cohort = await cohortStore.createCohort({ name: "Cabo", createdBy: "u1" });
  return cycleStore.createCycle({
    cohortId: cohort.id,
    name: "Day 3",
    startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-08T00:00:00Z"),
    itemTypeKeys: ["mango"],
    participantIds,
    createdBy: "u1",
  });
}

describe("createPostgresCurrentCycleStore", () => {
  it("returns undefined when no pointer is set", async () => {
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("stores and resolves a pointer for a participant of an open cycle", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    const resolved = await store.getCurrentCycle("u1");
    expect(resolved?.id).toBe(cycle.id);
    expect(resolved?.participantIds).toContain("u1");
  });

  it("replaces rather than duplicates on a second set", async () => {
    const a = await makeCycle();
    const b = await makeCycle();
    await store.setCurrentCycle("u1", a.id);
    await store.setCurrentCycle("u1", b.id);

    expect((await store.getCurrentCycle("u1"))?.id).toBe(b.id);
    const rows = await pool.query("SELECT 1 FROM user_current_cycle WHERE clerk_user_id = $1", ["u1"]);
    expect(rows.rowCount).toBe(1);
  });

  it("keeps each user's pointer separate", async () => {
    const a = await makeCycle();
    const b = await makeCycle();
    await store.setCurrentCycle("u1", a.id);
    await store.setCurrentCycle("u2", b.id);
    expect((await store.getCurrentCycle("u1"))?.id).toBe(a.id);
    expect((await store.getCurrentCycle("u2"))?.id).toBe(b.id);
  });

  // The three invalidation cases. A stale pointer is never an error — the caller
  // renders the session chooser instead.
  it("ignores a pointer at a closed cycle", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await cycleStore.closeCycle(cycle.id, "u1");
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("resolves again once a closed cycle is reopened", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await cycleStore.closeCycle(cycle.id, "u1");
    await cycleStore.reopenCycle(cycle.id);
    expect((await store.getCurrentCycle("u1"))?.id).toBe(cycle.id);
  });

  it("ignores a pointer once the user is no longer a participant", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    // v0.2's group-removal flow does exactly this for open sessions.
    await pool.query(
      "DELETE FROM cycle_participants WHERE cycle_id = $1 AND clerk_user_id = $2",
      [cycle.id, "u1"],
    );
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("drops the row when the cycle is deleted", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await pool.query("DELETE FROM cycles WHERE id = $1", [cycle.id]);

    expect(await store.getCurrentCycle("u1")).toBeUndefined();
    const rows = await pool.query("SELECT 1 FROM user_current_cycle WHERE clerk_user_id = $1", ["u1"]);
    expect(rows.rowCount).toBe(0);
  });

  it("clears an explicitly cleared pointer", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await store.clearCurrentCycle("u1");
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("treats clearing an unset pointer as a no-op", async () => {
    await expect(store.clearCurrentCycle("nobody")).resolves.toBeUndefined();
  });

  it("refuses a pointer at a cycle that does not exist", async () => {
    await expect(store.setCurrentCycle("u1", randomUUID())).rejects.toThrow();
  });
});
