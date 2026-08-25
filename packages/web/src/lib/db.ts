import { Pool } from "pg";
import {
  createPostgresCohortStore,
  createPostgresCurrentCycleStore,
  createPostgresCycleStore,
  createPostgresItemTypeStore,
  createPostgresLedgerStore,
  createPostgresUserRoleStore,
} from "core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const userRoleStore = createPostgresUserRoleStore(pool);
export const cohortStore = createPostgresCohortStore(pool);
export const cycleStore = createPostgresCycleStore(pool);
export const itemTypeStore = createPostgresItemTypeStore(pool);
export const ledgerStore = createPostgresLedgerStore(pool);
export const currentCycleStore = createPostgresCurrentCycleStore(pool, (id) =>
  cycleStore.getCycle(id),
);
