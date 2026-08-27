import { Pool } from "pg";
import {
  createPostgresCohortStore,
  createPostgresCurrentCycleStore,
  createPostgresCycleStore,
  createPostgresItemTypeStore,
  createPostgresLedgerStore,
  createPostgresUserRoleStore,
} from "core";

/**
 * One pool per process, reused across dev's HMR module reloads.
 *
 * Without the globalThis guard every hot reload built a new Pool and abandoned
 * the old one's sockets, so a long dev session leaked connections until Postgres
 * refused new ones. Production only evaluates this module once per instance, but
 * the guard is free there.
 *
 * `max: 5`, not pg's default of 10: on Vercel each concurrent function instance
 * builds its own pool, so the ceiling that matters is max x instances, not max.
 * Ten apiece exhausts a small Postgres well before the app is under real load.
 *
 * `connectionTimeoutMillis` matters more than it looks — pg waits forever by
 * default, so a saturated pool turns into a hung request and eventually a
 * function timeout with no error to read. Ten seconds fails loudly instead.
 */
function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

const globalForPool = globalThis as typeof globalThis & { __mangoPool?: Pool };
const pool = globalForPool.__mangoPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalForPool.__mangoPool = pool;
}

export const userRoleStore = createPostgresUserRoleStore(pool);
export const cohortStore = createPostgresCohortStore(pool);
export const cycleStore = createPostgresCycleStore(pool);
export const itemTypeStore = createPostgresItemTypeStore(pool);
export const ledgerStore = createPostgresLedgerStore(pool);
export const currentCycleStore = createPostgresCurrentCycleStore(pool, (id) =>
  cycleStore.getCycle(id),
);
