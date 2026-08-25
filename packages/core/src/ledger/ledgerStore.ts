import type { Pool } from "pg";
import type {
  Aggregate,
  AppendContext,
  AppendOp,
  AppendRejection,
  AppendResult,
  DeltaPage,
  LedgerEntry,
} from "./types.js";
import { UNTAGGED } from "./types.js";

export interface LedgerStore {
  append(cycleId: string, ctx: AppendContext, ops: AppendOp[]): Promise<AppendResult>;
  readSince(cycleId: string, afterSeq: number, limit: number): Promise<DeltaPage>;
  snapshot(cycleId: string): Promise<Aggregate>;
  listEntriesForSubject(cycleId: string, subjectUserId: string): Promise<LedgerEntry[]>;
  /** By server id — the admin void path clicks a row the server rendered. */
  getEntryById(cycleId: string, entryId: string): Promise<LedgerEntry | undefined>;
}

interface EntryRow {
  id: string;
  cycle_id: string;
  /** BIGINT arrives from pg as a string. */
  seq: string;
  kind: "log" | "void";
  item_type_key: string;
  subject_user_id: string | null;
  actor_user_id: string;
  voids_entry_id: string | null;
  client_entry_id: string;
  occurred_at: Date;
  created_at: Date;
}

const ENTRY_COLUMNS =
  "id, cycle_id, seq, kind, item_type_key, subject_user_id, actor_user_id, " +
  "voids_entry_id, client_entry_id, occurred_at, created_at";

function toEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    seq: Number(row.seq),
    kind: row.kind,
    itemTypeKey: row.item_type_key,
    subjectUserId: row.subject_user_id,
    actorUserId: row.actor_user_id,
    voidsEntryId: row.voids_entry_id,
    clientEntryId: row.client_entry_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export function createPostgresLedgerStore(pool: Pool): LedgerStore {
  return {
    async append(cycleId, ctx, ops) {
      const accepted: string[] = [];
      const duplicates: string[] = [];
      const rejected: AppendRejection[] = [];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // SELECT ... FOR UPDATE takes a row lock on the cycle that is held until
        // COMMIT. That is what forces commit order to match sequence order: a
        // second appender cannot read last_seq until this transaction commits.
        //
        // Do NOT replace this with a bigserial. With a global sequence, txn A can
        // take seq 5 and txn B seq 6, and B can commit first — a client polling
        // "everything after 4" then sees 6, advances its cursor past 5, and loses
        // entry 5 permanently with nothing to indicate it happened.
        const cycleResult = await client.query<{ closed_at: Date | null; last_seq: string }>(
          "SELECT closed_at, last_seq FROM cycles WHERE id = $1 FOR UPDATE",
          [cycleId],
        );
        const cycleRow = cycleResult.rows[0];
        if (!cycleRow) {
          await client.query("ROLLBACK");
          return { cursor: 0, accepted, duplicates, rejected };
        }

        const closed = cycleRow.closed_at !== null;
        let seq = Number(cycleRow.last_seq);

        // One round trip to find replays, so a duplicate never consumes a sequence.
        const existing = await client.query<{ client_entry_id: string }>(
          `SELECT client_entry_id FROM ledger_entries
           WHERE cycle_id = $1 AND client_entry_id = ANY($2::uuid[])`,
          [cycleId, ops.map((op) => op.clientEntryId)],
        );
        const seen = new Set(existing.rows.map((row) => row.client_entry_id));

        // Item types are validated up front rather than by catching the foreign key
        // violation: a failed statement poisons the whole transaction in Postgres,
        // so one bad key would take the rest of the batch down with it.
        const requestedKeys = ops
          .map((op) => op.itemTypeKey)
          .filter((key): key is string => typeof key === "string");
        const knownKeys = new Set<string>();
        if (requestedKeys.length > 0) {
          const catalog = await client.query<{ key: string }>(
            "SELECT key FROM item_types WHERE key = ANY($1::text[])",
            [requestedKeys],
          );
          for (const row of catalog.rows) knownKeys.add(row.key);
        }

        for (const op of ops) {
          if (seen.has(op.clientEntryId)) {
            duplicates.push(op.clientEntryId);
            continue;
          }
          if (closed && !ctx.canWriteClosed) {
            rejected.push({ clientEntryId: op.clientEntryId, reason: "cycle_closed" });
            continue;
          }

          let itemTypeKey: string;
          let subjectUserId: string | null;
          let voidsEntryId: string | null = null;

          if (op.kind === "void") {
            if (!op.voidsClientEntryId) {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "malformed_op" });
              continue;
            }
            // Resolved by client id: offline, the voider may never have seen a
            // server id for the entry it is cancelling.
            const targetResult = await client.query<EntryRow>(
              `SELECT ${ENTRY_COLUMNS} FROM ledger_entries
               WHERE cycle_id = $1 AND client_entry_id = $2`,
              [cycleId, op.voidsClientEntryId],
            );
            const target = targetResult.rows[0];
            if (!target || target.kind !== "log") {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "unknown_target" });
              continue;
            }
            if (!ctx.canVoidOthers && target.subject_user_id !== ctx.actorUserId) {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "not_your_entry" });
              continue;
            }
            const already = await client.query(
              "SELECT 1 FROM ledger_entries WHERE cycle_id = $1 AND voids_entry_id = $2",
              [cycleId, target.id],
            );
            if ((already.rowCount ?? 0) > 0) {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "already_voided" });
              continue;
            }
            // Denormalized on purpose: the client fold is then a pure function over
            // the delta stream, needing no join and no row it may never have received.
            itemTypeKey = target.item_type_key;
            subjectUserId = target.subject_user_id;
            voidsEntryId = target.id;
          } else {
            if (!op.itemTypeKey) {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "malformed_op" });
              continue;
            }
            if (!knownKeys.has(op.itemTypeKey)) {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "unknown_item_type" });
              continue;
            }
            itemTypeKey = op.itemTypeKey;
            subjectUserId = op.subjectUserId === undefined ? ctx.actorUserId : op.subjectUserId;
            if (!ctx.canWriteForOthers && subjectUserId !== ctx.actorUserId) {
              rejected.push({ clientEntryId: op.clientEntryId, reason: "not_your_entry" });
              continue;
            }
          }

          seq += 1;
          await client.query(
            `INSERT INTO ledger_entries
               (cycle_id, seq, kind, item_type_key, subject_user_id, actor_user_id,
                voids_entry_id, client_entry_id, occurred_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              cycleId,
              seq,
              op.kind,
              itemTypeKey,
              subjectUserId,
              ctx.actorUserId,
              voidsEntryId,
              op.clientEntryId,
              op.occurredAt,
            ],
          );
          accepted.push(op.clientEntryId);
          seen.add(op.clientEntryId);
        }

        await client.query("UPDATE cycles SET last_seq = $2 WHERE id = $1", [cycleId, seq]);
        await client.query("COMMIT");
        return { cursor: seq, accepted, duplicates, rejected };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async readSince(cycleId, afterSeq, limit) {
      // One extra row answers hasMore without a second COUNT query.
      const result = await pool.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ledger_entries
         WHERE cycle_id = $1 AND seq > $2
         ORDER BY seq
         LIMIT $3`,
        [cycleId, afterSeq, limit + 1],
      );
      const hasMore = result.rows.length > limit;
      const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
      const entries = rows.map(toEntry);
      return {
        entries,
        nextCursor: entries.length > 0 ? entries[entries.length - 1]!.seq : afterSeq,
        hasMore,
      };
    },

    async snapshot(cycleId) {
      // One statement, so cursor and counts come from the same view of the table.
      // Two statements under READ COMMITTED could straddle a concurrent commit and
      // hand back a cursor that is ahead of the counts it reports.
      const result = await pool.query<{
        cursor: string;
        subject: string;
        item_type_key: string | null;
        count: string | null;
      }>(
        `WITH bound AS (
           SELECT COALESCE(MAX(seq), 0) AS cursor FROM ledger_entries WHERE cycle_id = $1
         )
         SELECT b.cursor,
                COALESCE(e.subject_user_id, $2) AS subject,
                e.item_type_key,
                SUM(CASE WHEN e.kind = 'log' THEN 1 ELSE -1 END)::int AS count
         FROM bound b
         LEFT JOIN ledger_entries e ON e.cycle_id = $1 AND e.seq <= b.cursor
         GROUP BY b.cursor, 2, 3`,
        [cycleId, UNTAGGED],
      );

      const counts: Record<string, Record<string, number>> = {};
      let cursor = 0;
      for (const row of result.rows) {
        cursor = Number(row.cursor);
        // The LEFT JOIN yields one all-null row when the cycle has no entries. It
        // carries the cursor and nothing else, so skip it rather than counting it.
        if (row.item_type_key === null || row.count === null) continue;
        (counts[row.subject] ??= {})[row.item_type_key] = Number(row.count);
      }
      return { cursor, counts };
    },

    async listEntriesForSubject(cycleId, subjectUserId) {
      const result = await pool.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ledger_entries
         WHERE cycle_id = $1 AND subject_user_id = $2
         ORDER BY seq`,
        [cycleId, subjectUserId],
      );
      return result.rows.map(toEntry);
    },

    async getEntryById(cycleId, entryId) {
      const result = await pool.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ledger_entries WHERE cycle_id = $1 AND id = $2`,
        [cycleId, entryId],
      );
      const row = result.rows[0];
      return row ? toEntry(row) : undefined;
    },
  };
}
