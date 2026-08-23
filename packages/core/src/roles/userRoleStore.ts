import type { Pool } from "pg";
import type { Role, UserRoleRecord } from "./types.js";

export interface UserRoleStore {
  getRole(clerkUserId: string): Promise<Role | undefined>;
  upsertRole(clerkUserId: string, role: Role): Promise<void>;
  listRoles(): Promise<UserRoleRecord[]>;
}

interface UserRoleRow {
  clerk_user_id: string;
  role: Role;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: UserRoleRow): UserRoleRecord {
  return {
    clerkUserId: row.clerk_user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPostgresUserRoleStore(pool: Pool): UserRoleStore {
  return {
    async getRole(clerkUserId) {
      const result = await pool.query<Pick<UserRoleRow, "role">>(
        "SELECT role FROM user_roles WHERE clerk_user_id = $1",
        [clerkUserId],
      );
      return result.rows[0]?.role;
    },

    async upsertRole(clerkUserId, role) {
      await pool.query(
        `INSERT INTO user_roles (clerk_user_id, role, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (clerk_user_id)
         DO UPDATE SET role = $2, updated_at = now()`,
        [clerkUserId, role],
      );
    },

    // Ordered so the admin user table doesn't reshuffle between requests.
    async listRoles() {
      const result = await pool.query<UserRoleRow>(
        `SELECT clerk_user_id, role, created_at, updated_at
         FROM user_roles
         ORDER BY created_at, clerk_user_id`,
      );
      return result.rows.map(toRecord);
    },
  };
}
