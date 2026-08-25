import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createPostgresItemTypeStore } from "./itemTypeStore.js";
import { runMigrations } from "../db/migrate.js";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see README, then `docker compose up -d`");
}
const { hostname } = new URL(connectionString);
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  throw new Error(
    `Refusing to run destructive tests against a non-local database (${hostname}). ` +
      "These tests DELETE FROM item_types.",
  );
}

const pool = new Pool({ connectionString });
const store = createPostgresItemTypeStore(pool);

beforeAll(async () => {
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query("DELETE FROM item_types");
});

afterAll(async () => {
  await pool.query("DELETE FROM item_types");
  await pool.end();
});

const SEED = [
  { key: "alpha", emoji: "🅰️", label: "Alpha", position: 0 },
  { key: "beta", emoji: "🅱️", label: "Beta", position: 1 },
];

describe("createPostgresItemTypeStore", () => {
  it("seeds entries and reports how many were inserted", async () => {
    expect(await store.seedItemTypes(SEED)).toBe(2);
    expect((await store.listItemTypes()).map((t) => t.key)).toEqual(["alpha", "beta"]);
  });

  // The whole point of the seed contract: it runs on every deploy and must never
  // stomp the Super Admin's curation.
  it("re-seeding inserts nothing and preserves edits", async () => {
    await store.seedItemTypes(SEED);
    await store.updateItemType("alpha", { enabled: false, label: "Renamed" });

    expect(await store.seedItemTypes(SEED)).toBe(0);

    const alpha = (await store.listItemTypes()).find((t) => t.key === "alpha");
    expect(alpha?.enabled).toBe(false);
    expect(alpha?.label).toBe("Renamed");
  });

  it("filters to enabled entries on request", async () => {
    await store.seedItemTypes(SEED);
    await store.updateItemType("beta", { enabled: false });

    const enabled = await store.listItemTypes({ enabledOnly: true });
    expect(enabled.map((t) => t.key)).toEqual(["alpha"]);
  });

  it("updates only the fields it is given", async () => {
    await store.seedItemTypes(SEED);
    const updated = await store.updateItemType("alpha", { label: "Renamed" });
    expect(updated?.label).toBe("Renamed");
    expect(updated?.enabled).toBe(true);
  });

  it("returns undefined when updating an unknown key", async () => {
    expect(await store.updateItemType("nope", { enabled: false })).toBeUndefined();
  });
});
