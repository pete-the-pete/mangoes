import type { Pool } from "pg";
import type { CycleDetail } from "./types.js";

export interface CurrentCycleStore {
  /**
   * The caller's stored cycle pointer, or undefined.
   *
   * Validated on every read rather than trusted: the row must exist, the user
   * must still be a participant, and the cycle must not be closed. A pointer that
   * fails any of those is not an error and must not be surfaced as one — the
   * caller renders a chooser instead.
   */
  getCurrentCycle(clerkUserId: string): Promise<CycleDetail | undefined>;
  setCurrentCycle(clerkUserId: string, cycleId: string): Promise<void>;
  clearCurrentCycle(clerkUserId: string): Promise<void>;
}

/**
 * `readDetail` is injected rather than reimplemented so this store never
 * duplicates CycleStore's detail assembly. Wire it as
 * `createPostgresCurrentCycleStore(pool, (id) => cycleStore.getCycle(id))`.
 */
export function createPostgresCurrentCycleStore(
  pool: Pool,
  readDetail: (cycleId: string) => Promise<CycleDetail | undefined>,
): CurrentCycleStore {
  return {
    async getCurrentCycle(clerkUserId) {
      const result = await pool.query<{ cycle_id: string }>(
        `SELECT c.id AS cycle_id
         FROM user_current_cycle u
         JOIN cycles c ON c.id = u.cycle_id
         JOIN cycle_participants p
           ON p.cycle_id = c.id AND p.clerk_user_id = u.clerk_user_id
         WHERE u.clerk_user_id = $1 AND c.closed_at IS NULL`,
        [clerkUserId],
      );
      const row = result.rows[0];
      return row ? readDetail(row.cycle_id) : undefined;
    },

    async setCurrentCycle(clerkUserId, cycleId) {
      // The foreign key rejects a cycle that does not exist. Letting it throw is
      // deliberate: a caller pointing at a nonexistent cycle has a bug, unlike a
      // pointer that merely went stale, which getCurrentCycle handles silently.
      await pool.query(
        `INSERT INTO user_current_cycle (clerk_user_id, cycle_id)
         VALUES ($1, $2)
         ON CONFLICT (clerk_user_id) DO UPDATE SET cycle_id = $2, updated_at = now()`,
        [clerkUserId, cycleId],
      );
    },

    async clearCurrentCycle(clerkUserId) {
      await pool.query("DELETE FROM user_current_cycle WHERE clerk_user_id = $1", [clerkUserId]);
    },
  };
}
