import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createPostgresCohortStore } from "./cohortStore.js";
import { createPostgresCycleStore } from "../cycles/cycleStore.js";
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

beforeAll(async () => {
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO item_types (key, emoji, label, position)
     VALUES ('mango', '🥭', 'Mango', 0)
     ON CONFLICT (key) DO NOTHING`,
  );
});

beforeEach(async () => {
  // cohort_members cascades from cohorts.
  await pool.query("DELETE FROM cohorts");
});

afterAll(async () => {
  await pool.query("DELETE FROM cohorts");
  await pool.query("DELETE FROM item_types WHERE key = 'mango'");
  await pool.end();
});

describe("createPostgresCohortStore", () => {
  it("creates a cohort with the creator as its first admin", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });

    expect(cohort.name).toBe("Cabo");
    expect(cohort.createdBy).toBe("u1");
    expect(await store.getMemberRole(cohort.id, "u1")).toBe("admin");
  });

  it("returns undefined for a user who is not a member", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    expect(await store.getMemberRole(cohort.id, "stranger")).toBeUndefined();
  });

  it("lists only the cohorts a user belongs to", async () => {
    const store = createPostgresCohortStore(pool);
    const mine = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    await store.createCohort({ name: "Tulum", createdBy: "u2" });

    const rows = await store.listCohortsForUser("u1");
    expect(rows.map((c) => c.id)).toEqual([mine.id]);
  });

  it("adds, promotes, and removes a member", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });

    await store.addMember(cohort.id, "u2", "member");
    expect(await store.getMemberRole(cohort.id, "u2")).toBe("member");

    await store.updateMemberRole(cohort.id, "u2", "admin");
    expect(await store.getMemberRole(cohort.id, "u2")).toBe("admin");

    await store.removeMember(cohort.id, "u2");
    expect(await store.getMemberRole(cohort.id, "u2")).toBeUndefined();
  });

  it("renames a cohort", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    const renamed = await store.renameCohort(cohort.id, "Cabo 2026");
    expect(renamed?.name).toBe("Cabo 2026");
  });

  it("reports the cohorts where a user is an admin, with admin counts", async () => {
    const store = createPostgresCohortStore(pool);
    const solo = await store.createCohort({ name: "Solo", createdBy: "u1" });
    const shared = await store.createCohort({ name: "Shared", createdBy: "u1" });
    await store.addMember(shared.id, "u2", "admin");

    const memberships = await store.listAdminMembershipsForUser("u1");
    const byId = new Map(memberships.map((m) => [m.cohortId, m.adminCount]));
    expect(byId.get(solo.id)).toBe(1);
    expect(byId.get(shared.id)).toBe(2);
  });

  it("demotes every admin membership a user holds", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Shared", createdBy: "u1" });
    await store.addMember(cohort.id, "u2", "admin");

    await store.demoteAdminMemberships("u2");
    expect(await store.getMemberRole(cohort.id, "u2")).toBe("member");
  });
  it("clears participant rows on open cycles but not closed ones", async () => {
    const store = createPostgresCohortStore(pool);
    const cycles = createPostgresCycleStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    await store.addMember(cohort.id, "u2", "member");

    const shared = {
      cohortId: cohort.id,
      startsAt: new Date("2026-09-01T00:00:00Z"),
      endsAt: new Date("2026-09-08T00:00:00Z"),
      itemTypeKeys: ["mango"],
      participantIds: ["u1", "u2"],
      createdBy: "u1",
    };
    const open = await cycles.createCycle({ ...shared, name: "Open" });
    const closed = await cycles.createCycle({ ...shared, name: "Closed" });
    await cycles.closeCycle(closed.id, "u1");

    await store.removeMember(cohort.id, "u2");

    expect((await cycles.getCycle(open.id))?.participantIds).toEqual(["u1"]);
    expect([...((await cycles.getCycle(closed.id))?.participantIds ?? [])].sort())
      .toEqual(["u1", "u2"]);
  });
});
