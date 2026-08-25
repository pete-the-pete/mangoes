import type { Pool } from "pg";
import type {
  Cohort,
  CohortAdminMembership,
  CohortMemberRecord,
  CohortRole,
} from "./types.js";

export interface CreateCohortInput {
  name: string;
  createdBy: string;
}

export interface CohortStore {
  createCohort(input: CreateCohortInput): Promise<Cohort>;
  getCohort(cohortId: string): Promise<Cohort | undefined>;
  renameCohort(cohortId: string, name: string): Promise<Cohort | undefined>;
  listCohorts(): Promise<Cohort[]>;
  listCohortsForUser(clerkUserId: string): Promise<Cohort[]>;
  listMembers(cohortId: string): Promise<CohortMemberRecord[]>;
  getMemberRole(cohortId: string, clerkUserId: string): Promise<CohortRole | undefined>;
  addMember(cohortId: string, clerkUserId: string, role: CohortRole): Promise<void>;
  updateMemberRole(cohortId: string, clerkUserId: string, role: CohortRole): Promise<void>;
  removeMember(cohortId: string, clerkUserId: string): Promise<void>;
  listAdminMembershipsForUser(clerkUserId: string): Promise<CohortAdminMembership[]>;
  demoteAdminMemberships(clerkUserId: string): Promise<void>;
}

interface CohortRow {
  id: string;
  name: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function toCohort(row: CohortRow): Cohort {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COHORT_COLUMNS = "id, name, created_by, created_at, updated_at";

export function createPostgresCohortStore(pool: Pool): CohortStore {
  return {
    // Two writes, one transaction: a cohort with no admin is unadministerable,
    // and a half-applied create is exactly how you get one.
    async createCohort(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<CohortRow>(
          `INSERT INTO cohorts (name, created_by)
           VALUES ($1, $2)
           RETURNING ${COHORT_COLUMNS}`,
          [input.name, input.createdBy],
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error("INSERT ... RETURNING produced no row");
        }
        await client.query(
          `INSERT INTO cohort_members (cohort_id, clerk_user_id, role)
           VALUES ($1, $2, 'admin')`,
          [row.id, input.createdBy],
        );
        await client.query("COMMIT");
        return toCohort(row);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async getCohort(cohortId) {
      const result = await pool.query<CohortRow>(
        `SELECT ${COHORT_COLUMNS} FROM cohorts WHERE id = $1`,
        [cohortId],
      );
      const row = result.rows[0];
      return row ? toCohort(row) : undefined;
    },

    async renameCohort(cohortId, name) {
      const result = await pool.query<CohortRow>(
        `UPDATE cohorts SET name = $2, updated_at = now()
         WHERE id = $1
         RETURNING ${COHORT_COLUMNS}`,
        [cohortId, name],
      );
      const row = result.rows[0];
      return row ? toCohort(row) : undefined;
    },

    async listCohorts() {
      const result = await pool.query<CohortRow>(
        `SELECT ${COHORT_COLUMNS} FROM cohorts ORDER BY created_at, id`,
      );
      return result.rows.map(toCohort);
    },

    async listCohortsForUser(clerkUserId) {
      const result = await pool.query<CohortRow>(
        `SELECT c.id, c.name, c.created_by, c.created_at, c.updated_at
         FROM cohorts c
         JOIN cohort_members m ON m.cohort_id = c.id
         WHERE m.clerk_user_id = $1
         ORDER BY c.created_at, c.id`,
        [clerkUserId],
      );
      return result.rows.map(toCohort);
    },

    async listMembers(cohortId) {
      const result = await pool.query<{
        cohort_id: string;
        clerk_user_id: string;
        role: CohortRole;
        created_at: Date;
      }>(
        `SELECT cohort_id, clerk_user_id, role, created_at
         FROM cohort_members
         WHERE cohort_id = $1
         ORDER BY created_at, clerk_user_id`,
        [cohortId],
      );
      return result.rows.map((row) => ({
        cohortId: row.cohort_id,
        clerkUserId: row.clerk_user_id,
        role: row.role,
        createdAt: row.created_at,
      }));
    },

    async getMemberRole(cohortId, clerkUserId) {
      const result = await pool.query<{ role: CohortRole }>(
        `SELECT role FROM cohort_members WHERE cohort_id = $1 AND clerk_user_id = $2`,
        [cohortId, clerkUserId],
      );
      return result.rows[0]?.role;
    },

    async addMember(cohortId, clerkUserId, role) {
      await pool.query(
        `INSERT INTO cohort_members (cohort_id, clerk_user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (cohort_id, clerk_user_id) DO NOTHING`,
        [cohortId, clerkUserId, role],
      );
    },

    async updateMemberRole(cohortId, clerkUserId, role) {
      await pool.query(
        `UPDATE cohort_members SET role = $3
         WHERE cohort_id = $1 AND clerk_user_id = $2`,
        [cohortId, clerkUserId, role],
      );
    },

    // Task 3 extends this to clear participant rows on open cycles — that table
    // does not exist yet.
    async removeMember(cohortId, clerkUserId) {
      await pool.query(
        `DELETE FROM cohort_members WHERE cohort_id = $1 AND clerk_user_id = $2`,
        [cohortId, clerkUserId],
      );
    },

    async listAdminMembershipsForUser(clerkUserId) {
      const result = await pool.query<{
        cohort_id: string;
        cohort_name: string;
        admin_count: string;
      }>(
        `SELECT c.id AS cohort_id,
                c.name AS cohort_name,
                (SELECT count(*) FROM cohort_members a
                  WHERE a.cohort_id = c.id AND a.role = 'admin') AS admin_count
         FROM cohorts c
         JOIN cohort_members m ON m.cohort_id = c.id
         WHERE m.clerk_user_id = $1 AND m.role = 'admin'
         ORDER BY c.name, c.id`,
        [clerkUserId],
      );
      // count() comes back as a string from pg — bigint has no lossless JS type.
      return result.rows.map((row) => ({
        cohortId: row.cohort_id,
        cohortName: row.cohort_name,
        adminCount: Number(row.admin_count),
      }));
    },

    async demoteAdminMemberships(clerkUserId) {
      await pool.query(
        `UPDATE cohort_members SET role = 'member'
         WHERE clerk_user_id = $1 AND role = 'admin'`,
        [clerkUserId],
      );
    },
  };
}
