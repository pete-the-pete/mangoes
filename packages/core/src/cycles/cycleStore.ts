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

/**
 * One cycle row plus its participant and item-type lists, assembled in the
 * database rather than in three round trips.
 *
 * This used to be three sequential queries per cycle, which made
 * `listCyclesForCohort` cost 1 + 3N round trips — a group with 20 sessions paid
 * 61 of them, serialized, on both the member and admin group pages. The lateral
 * aggregates collapse that to exactly one query no matter how many cycles match.
 *
 * LEFT JOIN LATERAL rather than a plain GROUP BY: a cycle with no participants
 * or no item types still has to come back (an admin can save one mid-setup), and
 * grouping would need every cycle column in the GROUP BY to achieve the same
 * thing. COALESCE turns the resulting NULL aggregate into an empty array so
 * callers never see null.
 *
 * The ORDER BY inside each array_agg is what preserves the orderings the old
 * separate queries had: participants by creation, item types by the position the
 * admin's picker chose. Dropping them would silently reshuffle the tap targets.
 */
const CYCLE_DETAIL_FROM = `
  FROM cycles c
  LEFT JOIN LATERAL (
    SELECT array_agg(cp.clerk_user_id ORDER BY cp.created_at, cp.clerk_user_id) AS ids
    FROM cycle_participants cp
    WHERE cp.cycle_id = c.id
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(cit.item_type_key ORDER BY cit.position, cit.item_type_key) AS keys
    FROM cycle_item_types cit
    WHERE cit.cycle_id = c.id
  ) t ON true`;

const CYCLE_DETAIL_SELECT = `
  SELECT ${CYCLE_COLUMNS.split(", ")
    .map((column) => `c.${column}`)
    .join(", ")},
         COALESCE(p.ids, '{}') AS participant_ids,
         COALESCE(t.keys, '{}') AS item_type_keys
  ${CYCLE_DETAIL_FROM}`;

interface CycleDetailRow extends CycleRow {
  participant_ids: string[];
  item_type_keys: string[];
}

function toDetail(row: CycleDetailRow): CycleDetail {
  return {
    ...toCycle(row),
    participantIds: row.participant_ids,
    itemTypeKeys: row.item_type_keys,
  };
}

async function readDetail(
  runner: Pool | PoolClient,
  cycleId: string,
): Promise<CycleDetail | undefined> {
  const result = await runner.query<CycleDetailRow>(
    `${CYCLE_DETAIL_SELECT} WHERE c.id = $1`,
    [cycleId],
  );
  const row = result.rows[0];
  return row ? toDetail(row) : undefined;
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
      const result = await pool.query<CycleDetailRow>(
        `${CYCLE_DETAIL_SELECT}
         WHERE c.cohort_id = $1
         ORDER BY c.starts_at DESC, c.id`,
        [cohortId],
      );
      return result.rows.map(toDetail);
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
      // EXISTS rather than joining cycle_participants into the main query: the
      // lateral aggregate above already reads that table, and a second join to
      // it would multiply rows before aggregation.
      const result = await pool.query<CycleDetailRow>(
        `${CYCLE_DETAIL_SELECT}
         WHERE EXISTS (
           SELECT 1 FROM cycle_participants mp
           WHERE mp.cycle_id = c.id AND mp.clerk_user_id = $1
         )
         ORDER BY c.starts_at DESC, c.id`,
        [clerkUserId],
      );
      return result.rows.map(toDetail);
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
