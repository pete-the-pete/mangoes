import type { Pool, PoolClient } from "pg";
import type {
  CreateCycleInput,
  Cycle,
  CycleDetail,
  UpdateCycleInput,
} from "./types.js";

export interface CycleStore {
  createCycle(input: CreateCycleInput): Promise<CycleDetail>;
  getCycle(cycleId: string): Promise<CycleDetail | undefined>;
  listCyclesForCohort(cohortId: string): Promise<CycleDetail[]>;
  updateCycle(cycleId: string, input: UpdateCycleInput): Promise<CycleDetail | undefined>;
  closeCycle(cycleId: string, closedBy: string): Promise<CycleDetail | undefined>;
  reopenCycle(cycleId: string): Promise<CycleDetail | undefined>;
  /** Every cycle the user takes part in, newest window first. Closed ones included. */
  listCyclesForParticipant(clerkUserId: string): Promise<CycleDetail[]>;
  /** A single indexed lookup — this runs on every member API request. */
  isCycleParticipant(cycleId: string, clerkUserId: string): Promise<boolean>;
}

interface CycleRow {
  id: string;
  cohort_id: string;
  name: string;
  starts_at: Date;
  ends_at: Date;
  closed_at: Date | null;
  closed_by: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const CYCLE_COLUMNS =
  "id, cohort_id, name, starts_at, ends_at, closed_at, closed_by, created_by, created_at, updated_at";

function toCycle(row: CycleRow): Cycle {
  return {
    id: row.id,
    cohortId: row.cohort_id,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function replaceParticipants(
  client: PoolClient,
  cycleId: string,
  participantIds: string[],
): Promise<void> {
  await client.query("DELETE FROM cycle_participants WHERE cycle_id = $1", [cycleId]);
  for (const clerkUserId of participantIds) {
    await client.query(
      `INSERT INTO cycle_participants (cycle_id, clerk_user_id)
       VALUES ($1, $2)
       ON CONFLICT (cycle_id, clerk_user_id) DO NOTHING`,
      [cycleId, clerkUserId],
    );
  }
}

async function replaceItemTypes(
  client: PoolClient,
  cycleId: string,
  itemTypeKeys: string[],
): Promise<void> {
  await client.query("DELETE FROM cycle_item_types WHERE cycle_id = $1", [cycleId]);
  // Index is the caller's ordering — the picker's order is what the admin chose.
  for (const [position, key] of itemTypeKeys.entries()) {
    await client.query(
      `INSERT INTO cycle_item_types (cycle_id, item_type_key, position)
       VALUES ($1, $2, $3)
       ON CONFLICT (cycle_id, item_type_key) DO UPDATE SET position = $3`,
      [cycleId, key, position],
    );
  }
}

async function readDetail(
  runner: Pool | PoolClient,
  cycleId: string,
): Promise<CycleDetail | undefined> {
  const cycleResult = await runner.query<CycleRow>(
    `SELECT ${CYCLE_COLUMNS} FROM cycles WHERE id = $1`,
    [cycleId],
  );
  const row = cycleResult.rows[0];
  if (!row) {
    return undefined;
  }
  const participants = await runner.query<{ clerk_user_id: string }>(
    `SELECT clerk_user_id FROM cycle_participants
     WHERE cycle_id = $1 ORDER BY created_at, clerk_user_id`,
    [cycleId],
  );
  const itemTypes = await runner.query<{ item_type_key: string }>(
    `SELECT item_type_key FROM cycle_item_types
     WHERE cycle_id = $1 ORDER BY position, item_type_key`,
    [cycleId],
  );
  return {
    ...toCycle(row),
    participantIds: participants.rows.map((r) => r.clerk_user_id),
    itemTypeKeys: itemTypes.rows.map((r) => r.item_type_key),
  };
}

export function createPostgresCycleStore(pool: Pool): CycleStore {
  return {
    async createCycle(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<CycleRow>(
          `INSERT INTO cycles (cohort_id, name, starts_at, ends_at, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${CYCLE_COLUMNS}`,
          [input.cohortId, input.name, input.startsAt, input.endsAt, input.createdBy],
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error("INSERT ... RETURNING produced no row");
        }
        await replaceParticipants(client, row.id, input.participantIds);
        await replaceItemTypes(client, row.id, input.itemTypeKeys);
        const detail = await readDetail(client, row.id);
        if (!detail) {
          throw new Error("Cycle vanished mid-transaction");
        }
        await client.query("COMMIT");
        return detail;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async getCycle(cycleId) {
      return readDetail(pool, cycleId);
    },

    async listCyclesForCohort(cohortId) {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM cycles WHERE cohort_id = $1 ORDER BY starts_at DESC, id`,
        [cohortId],
      );
      const details: CycleDetail[] = [];
      for (const { id } of result.rows) {
        const detail = await readDetail(pool, id);
        if (detail) {
          details.push(detail);
        }
      }
      return details;
    },

    async updateCycle(cycleId, input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // COALESCE so an omitted field keeps its stored value — a PATCH that
        // sends only `name` must not blank the window.
        await client.query(
          `UPDATE cycles
           SET name = COALESCE($2, name),
               starts_at = COALESCE($3, starts_at),
               ends_at = COALESCE($4, ends_at),
               updated_at = now()
           WHERE id = $1`,
          [cycleId, input.name ?? null, input.startsAt ?? null, input.endsAt ?? null],
        );
        if (input.participantIds) {
          await replaceParticipants(client, cycleId, input.participantIds);
        }
        if (input.itemTypeKeys) {
          await replaceItemTypes(client, cycleId, input.itemTypeKeys);
        }
        const detail = await readDetail(client, cycleId);
        await client.query("COMMIT");
        return detail;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async closeCycle(cycleId, closedBy) {
      await pool.query(
        `UPDATE cycles SET closed_at = now(), closed_by = $2, updated_at = now()
         WHERE id = $1 AND closed_at IS NULL`,
        [cycleId, closedBy],
      );
      return readDetail(pool, cycleId);
    },

    async reopenCycle(cycleId) {
      await pool.query(
        `UPDATE cycles SET closed_at = NULL, closed_by = NULL, updated_at = now()
         WHERE id = $1`,
        [cycleId],
      );
      return readDetail(pool, cycleId);
    },

    async listCyclesForParticipant(clerkUserId) {
      const result = await pool.query<{ id: string }>(
        `SELECT c.id
         FROM cycles c
         JOIN cycle_participants p ON p.cycle_id = c.id
         WHERE p.clerk_user_id = $1
         ORDER BY c.starts_at DESC, c.id`,
        [clerkUserId],
      );
      const details = await Promise.all(result.rows.map((row) => readDetail(pool, row.id)));
      return details.filter((detail): detail is CycleDetail => detail !== undefined);
    },

    async isCycleParticipant(cycleId, clerkUserId) {
      // Deliberately not readDetail(): this runs on every member API request and
      // must not assemble participant and item-type lists it will never use.
      const result = await pool.query(
        "SELECT 1 FROM cycle_participants WHERE cycle_id = $1 AND clerk_user_id = $2",
        [cycleId, clerkUserId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}
