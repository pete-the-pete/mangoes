import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Pool } from "pg";

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema.sql",
);

/**
 * Applies the database schema. Idempotent — every statement in `schema.sql` is
 * written with `IF NOT EXISTS`, so this is safe to run on every boot.
 *
 * Run this against an unpooled connection: DDL over a transaction pooler can
 * land on a different backend than it started on.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const schema = readFileSync(schemaPath, "utf8");
  await pool.query(schema);
}
