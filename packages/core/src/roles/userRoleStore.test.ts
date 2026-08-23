import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createPostgresUserRoleStore } from "./userRoleStore.js";
import { runMigrations } from "../db/migrate.js";

// These tests DELETE FROM user_roles. `.env` exists so a developer can point at
// a different database (see README) — refuse to wipe anything but local Docker.
const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see README, then `docker compose up -d`");
}
const { hostname } = new URL(connectionString);
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  throw new Error(
    `Refusing to run destructive tests against a non-local database (${hostname}). ` +
      "These tests DELETE FROM user_roles.",
  );
}

const pool = new Pool({ connectionString });

beforeAll(async () => {
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query("DELETE FROM user_roles");
});

afterAll(async () => {
  // Leave the dev database as we found it — beforeEach only clears *before* a
  // test, so without this the last case's rows survive the run. A stray second
  // `owner` would quietly defeat the last-owner guard during Task 6/7's manual
  // verification.
  await pool.query("DELETE FROM user_roles");
  await pool.end();
});

describe("createPostgresUserRoleStore", () => {
  it("returns undefined for a user with no role row", async () => {
    const store = createPostgresUserRoleStore(pool);
    expect(await store.getRole("nobody")).toBeUndefined();
  });

  it("upserts and then returns the role", async () => {
    const store = createPostgresUserRoleStore(pool);
    await store.upsertRole("u1", "owner");
    expect(await store.getRole("u1")).toBe("owner");
  });

  it("upsert overwrites an existing role", async () => {
    const store = createPostgresUserRoleStore(pool);
    await store.upsertRole("u1", "member");
    await store.upsertRole("u1", "admin");
    expect(await store.getRole("u1")).toBe("admin");
  });

  it("lists all role records", async () => {
    const store = createPostgresUserRoleStore(pool);
    await store.upsertRole("u1", "owner");
    await store.upsertRole("u2", "member");
    const rows = await store.listRoles();
    expect(
      rows
        .map((r) => [r.clerkUserId, r.role])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["u1", "owner"],
      ["u2", "member"],
    ]);
  });
});
