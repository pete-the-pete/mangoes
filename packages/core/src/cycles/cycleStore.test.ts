import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
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
      "These tests DELETE FROM cycles.",
  );
}

const pool = new Pool({ connectionString });
const cohortStore = createPostgresCohortStore(pool);
const store = createPostgresCycleStore(pool);

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

async function makeCohort() {
  return cohortStore.createCohort({ name: "Cabo", createdBy: "u1" });
}

const WINDOW = {
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-08T00:00:00Z"),
};

describe("createPostgresCycleStore", () => {
  it("lists only the cycles a user participates in, newest window first", async () => {
    const cohort = await makeCohort();
    const mine = await store.createCycle({
      cohortId: cohort.id, name: "Earlier", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });
    const alsoMine = await store.createCycle({
      cohortId: cohort.id, name: "Later",
      startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-08T00:00:00Z"),
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });
    await store.createCycle({
      cohortId: cohort.id, name: "Not mine", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u2"], createdBy: "u1",
    });

    const result = await store.listCyclesForParticipant("u1");
    expect(result.map((c) => c.id)).toEqual([alsoMine.id, mine.id]);
    expect(result[0]?.itemTypeKeys).toEqual(["mango"]);
  });

  it("returns an empty list for someone in no cycles", async () => {
    await makeCohort();
    expect(await store.listCyclesForParticipant("nobody")).toEqual([]);
  });

  it("includes closed cycles — browsing past sessions is a member surface", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id, name: "Done", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });
    await store.closeCycle(cycle.id, "u1");
    const result = await store.listCyclesForParticipant("u1");
    expect(result.map((c) => c.id)).toEqual([cycle.id]);
    expect(result[0]?.closedAt).not.toBeNull();
  });

  it("answers participation without loading the whole cycle", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id, name: "Beach day", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });
    expect(await store.isCycleParticipant(cycle.id, "u1")).toBe(true);
    expect(await store.isCycleParticipant(cycle.id, "u9")).toBe(false);
  });

  it("reports false for a cycle that does not exist", async () => {
    expect(await store.isCycleParticipant(
      "00000000-0000-4000-8000-000000000000", "u1")).toBe(false);
  });

  it("creates a cycle with its participants and item types", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id,
      name: "Beach day",
      ...WINDOW,
      itemTypeKeys: ["mango", "taco"],
      participantIds: ["u1", "u2"],
      createdBy: "u1",
    });

    expect(cycle.name).toBe("Beach day");
    expect(cycle.closedAt).toBeNull();
    expect([...cycle.participantIds].sort()).toEqual(["u1", "u2"]);
    expect(cycle.itemTypeKeys).toEqual(["mango", "taco"]);
  });

  it("lists the cycles of one cohort only", async () => {
    const mine = await makeCohort();
    const other = await cohortStore.createCohort({ name: "Tulum", createdBy: "u9" });
    await store.createCycle({
      cohortId: mine.id, name: "Mine", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });
    await store.createCycle({
      cohortId: other.id, name: "Theirs", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u9"], createdBy: "u9",
    });

    const rows = await store.listCyclesForCohort(mine.id);
    expect(rows.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("replaces participants and item types on update", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id, name: "Beach day", ...WINDOW,
      itemTypeKeys: ["mango", "taco"], participantIds: ["u1", "u2"], createdBy: "u1",
    });

    const updated = await store.updateCycle(cycle.id, {
      itemTypeKeys: ["mango"],
      participantIds: ["u1"],
    });

    expect(updated?.itemTypeKeys).toEqual(["mango"]);
    expect(updated?.participantIds).toEqual(["u1"]);
  });

  it("closes and reopens a cycle", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id, name: "Beach day", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });

    const closed = await store.closeCycle(cycle.id, "u1");
    expect(closed?.closedAt).toBeInstanceOf(Date);
    expect(closed?.closedBy).toBe("u1");

    const reopened = await store.reopenCycle(cycle.id);
    expect(reopened?.closedAt).toBeNull();
    expect(reopened?.closedBy).toBeNull();
  });

  it("rejects a window that ends before it starts", async () => {
    const cohort = await makeCohort();
    await expect(
      store.createCycle({
        cohortId: cohort.id,
        name: "Backwards",
        startsAt: new Date("2026-09-08T00:00:00Z"),
        endsAt: new Date("2026-09-01T00:00:00Z"),
        itemTypeKeys: ["mango"],
        participantIds: ["u1"],
        createdBy: "u1",
      }),
    ).rejects.toThrow();
  });
});
