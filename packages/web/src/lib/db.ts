import { Pool } from "pg";
import { createPostgresUserRoleStore } from "core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const userRoleStore = createPostgresUserRoleStore(pool);
