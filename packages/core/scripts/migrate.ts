import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate.js";

async function main(): Promise<void> {
  // Neon (via Vercel) exposes both a pooled and an unpooled connection string.
  // DDL must go over the unpooled one; locally only DATABASE_URL is set.
  const connectionString =
    process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString });
  try {
    await runMigrations(pool);
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
