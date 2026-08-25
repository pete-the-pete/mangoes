import { Pool } from "pg";
import { createPostgresItemTypeStore } from "core";
import { ITEM_TYPE_CATALOG } from "../src/lib/itemTypeCatalog";

async function main(): Promise<void> {
  // Same preference as migrate.ts: Neon's unpooled string when present.
  const connectionString =
    process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString });
  try {
    const store = createPostgresItemTypeStore(pool);
    const inserted = await store.seedItemTypes(ITEM_TYPE_CATALOG);
    console.log(
      `Item type catalog seeded: ${inserted} added, ${ITEM_TYPE_CATALOG.length - inserted} already present.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
