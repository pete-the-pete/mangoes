# Groups & Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the administrative half of groups and sessions — a platform Admin can create a group,
invite people to it by email, and create time-boxed sessions that declare which emoji items they
track, all under `/admin`.

**Architecture:** `packages/core` gains three framework-agnostic modules — `cohorts` (groups),
`cycles` (sessions), and `itemTypes` (the emoji catalog) — each with a Postgres-backed store behind
an interface and pure guards in their own files. `packages/web` adds a second authorization axis
(`requireCohortRole`, composing platform role with per-group role), the route handlers, the admin UI,
and the food-emoji seed data that core is forbidden to contain.

**Tech Stack:** Next.js App Router (`packages/web`), plain TypeScript (`packages/core`), Postgres via
`pg`, Clerk (`@clerk/nextjs` v7) for invitations, Vitest for tests, Docker Compose for local Postgres.

**Spec:** [`docs/specs/2026-08-24-groups-and-sessions-design.md`](../specs/2026-08-24-groups-and-sessions-design.md)

## Global Constraints

- TypeScript strict mode everywhere, no implicit `any` (root `CLAUDE.md`). `exactOptionalPropertyTypes`
  is on — an optional property that can be absent must be typed `?: T | undefined`.
- `packages/core` may never import from `packages/web`, Next.js, or Clerk, and may never contain
  app-specific nouns — "mango," "group," "trip," "day," "wager" (root `CLAUDE.md`). **This is why the
  emoji seed list lives in `packages/web`: it contains the words "mango" and "taco".**
- Core says `Cohort`/`Cycle`; `packages/web` says Group/Session in every URL, identifier, and piece
  of user-visible copy (spec: Architecture). The mapping is one-way and lives only in web.
- `CohortRole` (`"admin" | "member"`) is a distinct type from the platform `Role`
  (`"owner" | "admin" | "member"`). They are never assignable to each other (spec: Architecture).
- A group must never be left with zero admins, by any write path (spec: Authorization).
- A user may hold `cohort_members.role = 'admin'` only if their platform role is `admin` or `owner`
  (spec: Authorization).
- Guard rejections use the shipped status conventions: `401` unauthenticated, `403` not authorized,
  `400` malformed/invalid input, **`409` state conflict** (last-admin rejections, matching
  `wouldRemoveLastOwner`'s shipped behavior), `404` not found, `502` upstream Clerk failure.
- `packages/core` uses `.js` import extensions (NodeNext); `packages/web` uses extensionless relative
  imports (`./db`) — it is `moduleResolution: bundler`.
- `core`'s `main`/`types` point at a gitignored `dist/`, so `npm run build -w core` must precede any
  `web` build, test, or dev run.
- **Core tests run against real local Postgres** (`docker compose up -d` first) and are destructive —
  they refuse to run against a non-localhost host. **Web tests mock `@/lib/auth`, `@/lib/cohortAuth`,
  and `@/lib/db` with `vi.mock` and open no database connection**, exactly as
  `packages/web/tests/integration/admin-api/users-role.test.ts` does today.
- **`packages/core`'s Vitest runs test files sequentially** (`fileParallelism: false`, set in Task 1).
  Four test files now share one local Postgres and delete rows from tables the others reference;
  parallel files turn that into FK violations and rows disappearing mid-test. Do not remove it to
  make the suite faster.
- No E2E/browser tests in this slice (spec: Testing) — UI tasks are verified manually via the dev
  server, with the steps written into each UI task.
- Every `/admin/api/*` route handler calls its guard **itself**. Route handlers do not run layouts, so
  `app/admin/layout.tsx` protects pages only (see the comment in `packages/web/src/lib/auth.ts`).

---

## File Structure

**`packages/core`** — three new modules, each mirroring the shipped `roles/` layout:

| File | Responsibility |
|---|---|
| `src/cohorts/types.ts` | `Cohort`, `CohortRole`, `CohortMemberRecord`, `CohortMemberChange`, `CohortAdminMembership` |
| `src/cohorts/lastCohortAdminGuard.ts` | `wouldRemoveLastCohortAdmin` — pure, no I/O |
| `src/cohorts/cohortStore.ts` | `CohortStore` interface + `createPostgresCohortStore` |
| `src/cohorts/index.ts` | Re-exports |
| `src/cycles/types.ts` | `Cycle`, `CycleDetail`, `CycleStatus`, `CreateCycleInput`, `UpdateCycleInput` |
| `src/cycles/cycleStatus.ts` | `deriveCycleStatus`, `isCycleOverdue` — pure, no I/O |
| `src/cycles/cycleStore.ts` | `CycleStore` interface + `createPostgresCycleStore` |
| `src/cycles/index.ts` | Re-exports |
| `src/itemTypes/types.ts` | `ItemType`, `ItemTypeSeed`, `ItemTypeUpdate` |
| `src/itemTypes/itemTypeStore.ts` | `ItemTypeStore` interface + `createPostgresItemTypeStore` |
| `src/itemTypes/index.ts` | Re-exports |
| `src/db/schema.sql` | **Modified by Tasks 1, 3, and 4** — see the collision note below |
| `src/index.ts` | Modified — re-exports the three new modules |

**`packages/web`:**

| File | Responsibility |
|---|---|
| `src/lib/email.ts` | `isGmailAddress` — extracted from the invite route, now two callers |
| `src/lib/cohortAuth.ts` | `requireCohortRole` — platform gate + group role |
| `src/lib/db.ts` | Modified — exports the three new store singletons |
| `src/lib/itemTypeCatalog.ts` | The food-emoji seed array (web-only, per the boundary) |
| `src/lib/pendingCohortInvite.ts` | Join-on-first-sign-in + metadata clearing |
| `src/lib/adminGroups.ts` | Read helpers for server components (identity joined from Clerk) |
| `scripts/seed-item-types.ts` | Idempotent catalog seeding, run from `vercel-build` |
| `src/app/admin/api/groups/**` | Route handlers (groups, members, invites, sessions) |
| `src/app/admin/api/item-types/**` | Route handlers (catalog list + owner-only update) |
| `src/app/admin/groups/**` | Group list, group detail, session detail pages + colocated client components |
| `src/app/admin/item-types/page.tsx` | Owner-only catalog page |
| `src/app/admin/AdminNav.tsx` | Nav shared by every `/admin` page |

**Schema collision:** Tasks 1, 3, and 4 each append to the single `packages/core/src/db/schema.sql`.
They are logically independent but textually collide. Merge them in numeric order, or expect a
trivial conflict on rebase — resolve it by keeping **both** table blocks, never by taking one side
wholesale.

---

## Task 1: Core — cohorts schema, types, and store

**Files:**
- Create: `packages/core/src/cohorts/types.ts`
- Create: `packages/core/src/cohorts/cohortStore.ts`
- Create: `packages/core/src/cohorts/index.ts`
- Create: `packages/core/src/cohorts/cohortStore.test.ts`
- Modify: `packages/core/src/db/schema.sql` (append two tables)
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/vitest.config.ts` (`fileParallelism: false`)

**Interfaces:**
- Consumes: `runMigrations(pool)` from `../db/migrate.js` (shipped).
- Produces: `CohortRole`, `Cohort`, `CohortMemberRecord`, `CohortMemberChange`,
  `CohortAdminMembership`, `CohortStore`, `createPostgresCohortStore(pool: Pool): CohortStore`.

- [ ] **Step 1: Append the schema**

Add to the end of `packages/core/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cohort_members (
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS cohort_members_user_idx ON cohort_members (clerk_user_id);
```

- [ ] **Step 2: Stop core's DB tests running in parallel**

Add to `packages/core/vitest.config.ts`, inside `test`:

```ts
    // Every DB test file here shares one local Postgres and deletes rows from
    // it. Vitest runs files in parallel by default, which turns that sharing
    // into FK violations and rows vanishing mid-test. Sequential files, always
    // — this is correctness, not a speed knob.
    fileParallelism: false,
```

Today `userRoleStore.test.ts` is the only database test, so nothing has forced this yet. This
milestone adds three more (`cohortStore`, `cycleStore`, `itemTypeStore`), two of which delete from
tables the others reference. Set it now, before the second file exists.

- [ ] **Step 3: Write the types**

`packages/core/src/cohorts/types.ts`:

```ts
/** Per-cohort role. Deliberately NOT the platform `Role` — the two never mix. */
export type CohortRole = "admin" | "member";

export interface Cohort {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CohortMemberRecord {
  cohortId: string;
  clerkUserId: string;
  role: CohortRole;
  createdAt: Date;
}

/** What a caller wants to do to a member — the two ways to strand a cohort. */
export type CohortMemberChange =
  | { type: "role"; role: CohortRole }
  | { type: "remove" };

/** A cohort where a user is an admin, with that cohort's total admin count. */
export interface CohortAdminMembership {
  cohortId: string;
  cohortName: string;
  adminCount: number;
}
```

- [ ] **Step 4: Write the failing store test**

`packages/core/src/cohorts/cohortStore.test.ts`. The guard block at the top is copied from the
shipped `userRoleStore.test.ts` — these tests delete rows, so they refuse a non-local database:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createPostgresCohortStore } from "./cohortStore.js";
import { runMigrations } from "../db/migrate.js";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see README, then `docker compose up -d`");
}
const { hostname } = new URL(connectionString);
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  throw new Error(
    `Refusing to run destructive tests against a non-local database (${hostname}). ` +
      "These tests DELETE FROM cohorts.",
  );
}

const pool = new Pool({ connectionString });

beforeAll(async () => {
  await runMigrations(pool);
});

beforeEach(async () => {
  // cohort_members cascades from cohorts.
  await pool.query("DELETE FROM cohorts");
});

afterAll(async () => {
  await pool.query("DELETE FROM cohorts");
  await pool.end();
});

describe("createPostgresCohortStore", () => {
  it("creates a cohort with the creator as its first admin", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });

    expect(cohort.name).toBe("Cabo");
    expect(cohort.createdBy).toBe("u1");
    expect(await store.getMemberRole(cohort.id, "u1")).toBe("admin");
  });

  it("returns undefined for a user who is not a member", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    expect(await store.getMemberRole(cohort.id, "stranger")).toBeUndefined();
  });

  it("lists only the cohorts a user belongs to", async () => {
    const store = createPostgresCohortStore(pool);
    const mine = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    await store.createCohort({ name: "Tulum", createdBy: "u2" });

    const rows = await store.listCohortsForUser("u1");
    expect(rows.map((c) => c.id)).toEqual([mine.id]);
  });

  it("adds, promotes, and removes a member", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });

    await store.addMember(cohort.id, "u2", "member");
    expect(await store.getMemberRole(cohort.id, "u2")).toBe("member");

    await store.updateMemberRole(cohort.id, "u2", "admin");
    expect(await store.getMemberRole(cohort.id, "u2")).toBe("admin");

    await store.removeMember(cohort.id, "u2");
    expect(await store.getMemberRole(cohort.id, "u2")).toBeUndefined();
  });

  it("renames a cohort", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    const renamed = await store.renameCohort(cohort.id, "Cabo 2026");
    expect(renamed?.name).toBe("Cabo 2026");
  });

  it("reports the cohorts where a user is an admin, with admin counts", async () => {
    const store = createPostgresCohortStore(pool);
    const solo = await store.createCohort({ name: "Solo", createdBy: "u1" });
    const shared = await store.createCohort({ name: "Shared", createdBy: "u1" });
    await store.addMember(shared.id, "u2", "admin");

    const memberships = await store.listAdminMembershipsForUser("u1");
    const byId = new Map(memberships.map((m) => [m.cohortId, m.adminCount]));
    expect(byId.get(solo.id)).toBe(1);
    expect(byId.get(shared.id)).toBe(2);
  });

  it("demotes every admin membership a user holds", async () => {
    const store = createPostgresCohortStore(pool);
    const cohort = await store.createCohort({ name: "Shared", createdBy: "u1" });
    await store.addMember(cohort.id, "u2", "admin");

    await store.demoteAdminMemberships("u2");
    expect(await store.getMemberRole(cohort.id, "u2")).toBe("member");
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `docker compose up -d && npm run test -w core -- cohortStore`
Expected: FAIL — `Cannot find module './cohortStore.js'`.

- [ ] **Step 6: Implement the store**

`packages/core/src/cohorts/cohortStore.ts`:

```ts
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
```

- [ ] **Step 7: Write the barrel files**

`packages/core/src/cohorts/index.ts`:

```ts
export * from "./types.js";
export * from "./cohortStore.js";
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./cohorts/index.js";
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test -w core -- cohortStore && npm run typecheck -w core`
Expected: PASS, 7 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/cohorts packages/core/src/db/schema.sql packages/core/src/index.ts
git commit -m "Core: cohorts schema, types, and Postgres store"
```

---

## Task 2: Core — last-cohort-admin guard

**Blocked by:** Task 1 (needs `CohortMemberRecord`, `CohortMemberChange`).

**Files:**
- Create: `packages/core/src/cohorts/lastCohortAdminGuard.ts`
- Create: `packages/core/src/cohorts/lastCohortAdminGuard.test.ts`
- Modify: `packages/core/src/cohorts/index.ts`

**Interfaces:**
- Consumes: `CohortMemberRecord`, `CohortMemberChange` from Task 1.
- Produces: `wouldRemoveLastCohortAdmin(members, targetUserId, change): boolean`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/cohorts/lastCohortAdminGuard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wouldRemoveLastCohortAdmin } from "./lastCohortAdminGuard.js";

const members = [
  { clerkUserId: "a1", role: "admin" as const },
  { clerkUserId: "m1", role: "member" as const },
];

describe("wouldRemoveLastCohortAdmin", () => {
  it("blocks demoting the only admin", () => {
    expect(
      wouldRemoveLastCohortAdmin(members, "a1", { type: "role", role: "member" }),
    ).toBe(true);
  });

  it("blocks removing the only admin", () => {
    expect(wouldRemoveLastCohortAdmin(members, "a1", { type: "remove" })).toBe(true);
  });

  it("allows demoting an admin when another remains", () => {
    const two = [...members, { clerkUserId: "a2", role: "admin" as const }];
    expect(
      wouldRemoveLastCohortAdmin(two, "a1", { type: "role", role: "member" }),
    ).toBe(false);
  });

  it("allows removing a plain member", () => {
    expect(wouldRemoveLastCohortAdmin(members, "m1", { type: "remove" })).toBe(false);
  });

  it("is not tripped by a no-op admin-to-admin change", () => {
    expect(
      wouldRemoveLastCohortAdmin(members, "a1", { type: "role", role: "admin" }),
    ).toBe(false);
  });

  it("returns false for a user who is not a member at all", () => {
    expect(wouldRemoveLastCohortAdmin(members, "ghost", { type: "remove" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w core -- lastCohortAdminGuard`
Expected: FAIL — `Cannot find module './lastCohortAdminGuard.js'`.

- [ ] **Step 3: Implement the guard**

`packages/core/src/cohorts/lastCohortAdminGuard.ts`:

```ts
import type { CohortMemberChange, CohortMemberRecord } from "./types.js";

/**
 * True when applying `change` to `targetUserId` would leave the cohort with zero
 * admins. Pure — callers read current members and decide what to do.
 *
 * Two change shapes, unlike the platform's `wouldRemoveLastOwner`: platform users
 * cannot be deleted, but cohort members can be removed, and both paths strand a
 * cohort the same way.
 */
export function wouldRemoveLastCohortAdmin(
  members: Pick<CohortMemberRecord, "clerkUserId" | "role">[],
  targetUserId: string,
  change: CohortMemberChange,
): boolean {
  const target = members.find((m) => m.clerkUserId === targetUserId);
  if (!target || target.role !== "admin") {
    return false;
  }
  if (change.type === "role" && change.role === "admin") {
    return false;
  }
  const adminCount = members.filter((m) => m.role === "admin").length;
  return adminCount <= 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w core -- lastCohortAdminGuard`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export it**

Add to `packages/core/src/cohorts/index.ts`:

```ts
export * from "./lastCohortAdminGuard.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/cohorts
git commit -m "Core: last-cohort-admin guard"
```

---

## Task 3: Core — cycles schema, status derivation, and store

**Blocked by:** Tasks 1 and 4. Task 1 because `cycles` references `cohorts` and this task extends
`removeMember`; Task 4 because `cycle_item_types` references `item_types`, and this task's store
tests seed and write catalog rows.

**Files:**
- Create: `packages/core/src/cycles/types.ts`
- Create: `packages/core/src/cycles/cycleStatus.ts`
- Create: `packages/core/src/cycles/cycleStore.ts`
- Create: `packages/core/src/cycles/index.ts`
- Create: `packages/core/src/cycles/cycleStatus.test.ts`
- Create: `packages/core/src/cycles/cycleStore.test.ts`
- Modify: `packages/core/src/db/schema.sql` (append two tables)
- Modify: `packages/core/src/cohorts/cohortStore.ts` (`removeMember` clears open-cycle participants)
- Modify: `packages/core/src/cohorts/cohortStore.test.ts` (one new case)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `cohorts` table from Task 1.
- Produces: `Cycle`, `CycleDetail`, `CycleStatus`, `CreateCycleInput`, `UpdateCycleInput`,
  `deriveCycleStatus(cycle, now)`, `isCycleOverdue(cycle, now)`, `CycleStore`,
  `createPostgresCycleStore(pool)`.

- [ ] **Step 1: Append the schema**

Add to the end of `packages/core/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS cycles_cohort_idx ON cycles (cohort_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS cycle_participants (
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, clerk_user_id)
);

CREATE TABLE IF NOT EXISTS cycle_item_types (
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  item_type_key TEXT NOT NULL REFERENCES item_types(key),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cycle_id, item_type_key)
);
```

The join table lives here, not in Task 4, because it references **both** `cycles` and `item_types`.
`schema.sql` executes top to bottom in a single `pool.query`, so it must appear after both — which
makes it Task 3's problem, and makes Task 4 (which creates `item_types` alone, with no foreign keys)
genuinely standalone. Order in the merged file: cohorts → item types → cycles → cycle join tables.

- [ ] **Step 2: Write the types**

`packages/core/src/cycles/types.ts`:

```ts
export interface Cycle {
  id: string;
  cohortId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  /** The only durable close fact. Status is derived from it. */
  closedAt: Date | null;
  closedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Derived, never stored. See deriveCycleStatus. */
export type CycleStatus = "scheduled" | "live" | "closed";

export interface CycleDetail extends Cycle {
  participantIds: string[];
  itemTypeKeys: string[];
}

export interface CreateCycleInput {
  cohortId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  itemTypeKeys: string[];
  participantIds: string[];
  createdBy: string;
}

export interface UpdateCycleInput {
  name?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  itemTypeKeys?: string[] | undefined;
  participantIds?: string[] | undefined;
}
```

- [ ] **Step 3: Write the failing status test**

`packages/core/src/cycles/cycleStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveCycleStatus, isCycleOverdue } from "./cycleStatus.js";

const now = new Date("2026-08-24T12:00:00Z");
const window = (startsAt: string, endsAt: string, closedAt: Date | null = null) => ({
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  closedAt,
});

describe("deriveCycleStatus", () => {
  it("is scheduled before the window opens", () => {
    expect(deriveCycleStatus(window("2026-08-25T00:00:00Z", "2026-08-26T00:00:00Z"), now))
      .toBe("scheduled");
  });

  it("is live inside the window", () => {
    expect(deriveCycleStatus(window("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z"), now))
      .toBe("live");
  });

  // The decision that separates this product from a timer: closing is a
  // deliberate act, so a forgotten session is still live and still writable.
  it("is still live after the window ends when nobody closed it", () => {
    expect(deriveCycleStatus(window("2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z"), now))
      .toBe("live");
  });

  it("is closed once closedAt is set, even inside the window", () => {
    const closed = window("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z", now);
    expect(deriveCycleStatus(closed, now)).toBe("closed");
  });
});

describe("isCycleOverdue", () => {
  it("flags an open cycle past its end time", () => {
    expect(isCycleOverdue(window("2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z"), now))
      .toBe(true);
  });

  it("does not flag a closed cycle past its end time", () => {
    const closed = window("2026-08-20T00:00:00Z", "2026-08-21T00:00:00Z", now);
    expect(isCycleOverdue(closed, now)).toBe(false);
  });

  it("does not flag a cycle inside its window", () => {
    expect(isCycleOverdue(window("2026-08-24T00:00:00Z", "2026-08-25T00:00:00Z"), now))
      .toBe(false);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test -w core -- cycleStatus`
Expected: FAIL — `Cannot find module './cycleStatus.js'`.

- [ ] **Step 5: Implement status derivation**

`packages/core/src/cycles/cycleStatus.ts`:

```ts
import type { Cycle, CycleStatus } from "./types.js";

type CycleWindow = Pick<Cycle, "startsAt" | "endsAt" | "closedAt">;

/**
 * `closedAt` is the only durable fact; everything else is read off the clock.
 * A cycle past `endsAt` that nobody closed is still `live` — closing is an
 * explicit act, and the end time only prompts for it.
 */
export function deriveCycleStatus(cycle: CycleWindow, now: Date): CycleStatus {
  if (cycle.closedAt !== null) {
    return "closed";
  }
  return now.getTime() < cycle.startsAt.getTime() ? "scheduled" : "live";
}

/** Open, but past its end time — the UI prompts an admin to close it. */
export function isCycleOverdue(cycle: CycleWindow, now: Date): boolean {
  return cycle.closedAt === null && now.getTime() > cycle.endsAt.getTime();
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm run test -w core -- cycleStatus`
Expected: PASS, 7 tests.

- [ ] **Step 7: Write the failing store test**

`packages/core/src/cycles/cycleStore.test.ts` — same local-database guard block as Task 1's test
(copy it verbatim, changing the table named in the error message to `cycles`), then:

```ts
const pool = new Pool({ connectionString });
const cohortStore = createPostgresCohortStore(pool);
const store = createPostgresCycleStore(pool);

beforeAll(async () => {
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO item_types (key, emoji, label, position)
     VALUES ('mango', '🥭', 'Mango', 0), ('taco', '🌮', 'Taco', 1)
     ON CONFLICT (key) DO NOTHING`,
  );
});

beforeEach(async () => {
  await pool.query("DELETE FROM cohorts");
});

afterAll(async () => {
  await pool.query("DELETE FROM cohorts");
  await pool.query("DELETE FROM item_types WHERE key IN ('mango', 'taco')");
  await pool.end();
});

async function makeCohort() {
  return cohortStore.createCohort({ name: "Cabo", createdBy: "u1" });
}

const WINDOW = {
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-08T00:00:00Z"),
};

describe("createPostgresCycleStore", () => {
  it("creates a cycle with its participants and item types", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id,
      name: "Beach day",
      ...WINDOW,
      itemTypeKeys: ["mango", "taco"],
      participantIds: ["u1", "u2"],
      createdBy: "u1",
    });

    expect(cycle.name).toBe("Beach day");
    expect(cycle.closedAt).toBeNull();
    expect([...cycle.participantIds].sort()).toEqual(["u1", "u2"]);
    expect(cycle.itemTypeKeys).toEqual(["mango", "taco"]);
  });

  it("lists the cycles of one cohort only", async () => {
    const mine = await makeCohort();
    const other = await cohortStore.createCohort({ name: "Tulum", createdBy: "u9" });
    await store.createCycle({
      cohortId: mine.id, name: "Mine", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });
    await store.createCycle({
      cohortId: other.id, name: "Theirs", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u9"], createdBy: "u9",
    });

    const rows = await store.listCyclesForCohort(mine.id);
    expect(rows.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("replaces participants and item types on update", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id, name: "Beach day", ...WINDOW,
      itemTypeKeys: ["mango", "taco"], participantIds: ["u1", "u2"], createdBy: "u1",
    });

    const updated = await store.updateCycle(cycle.id, {
      itemTypeKeys: ["mango"],
      participantIds: ["u1"],
    });

    expect(updated?.itemTypeKeys).toEqual(["mango"]);
    expect(updated?.participantIds).toEqual(["u1"]);
  });

  it("closes and reopens a cycle", async () => {
    const cohort = await makeCohort();
    const cycle = await store.createCycle({
      cohortId: cohort.id, name: "Beach day", ...WINDOW,
      itemTypeKeys: ["mango"], participantIds: ["u1"], createdBy: "u1",
    });

    const closed = await store.closeCycle(cycle.id, "u1");
    expect(closed?.closedAt).toBeInstanceOf(Date);
    expect(closed?.closedBy).toBe("u1");

    const reopened = await store.reopenCycle(cycle.id);
    expect(reopened?.closedAt).toBeNull();
    expect(reopened?.closedBy).toBeNull();
  });

  it("rejects a window that ends before it starts", async () => {
    const cohort = await makeCohort();
    await expect(
      store.createCycle({
        cohortId: cohort.id,
        name: "Backwards",
        startsAt: new Date("2026-09-08T00:00:00Z"),
        endsAt: new Date("2026-09-01T00:00:00Z"),
        itemTypeKeys: ["mango"],
        participantIds: ["u1"],
        createdBy: "u1",
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npm run test -w core -- cycleStore`
Expected: FAIL — `Cannot find module './cycleStore.js'`. (If it instead fails on a missing
`item_types` table, Task 4 has not landed yet — see the note in Step 9.)

- [ ] **Step 9: Implement the store**

`packages/core/src/cycles/cycleStore.ts`. Note the `cycle_item_types` foreign key points at
`item_types`, created in Task 4 — **if Task 4 has not merged yet, run it first**; the two tasks are
independent in logic but the FK makes Task 3's tests need Task 4's table.

```ts
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
  };
}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `npm run test -w core -- cycleStore`
Expected: PASS, 5 tests.

- [ ] **Step 11: Extend `removeMember` to clear open-cycle participants**

Replace `removeMember` in `packages/core/src/cohorts/cohortStore.ts`:

```ts
    // Removing someone stops them participating going forward, but closed cycles
    // keep their roster — that list is the record of who was actually there, and
    // the logging slice hangs totals off exactly these rows.
    async removeMember(cohortId, clerkUserId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM cycle_participants p
           USING cycles c
           WHERE p.cycle_id = c.id
             AND c.cohort_id = $1
             AND c.closed_at IS NULL
             AND p.clerk_user_id = $2`,
          [cohortId, clerkUserId],
        );
        await client.query(
          `DELETE FROM cohort_members WHERE cohort_id = $1 AND clerk_user_id = $2`,
          [cohortId, clerkUserId],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
```

- [ ] **Step 12: Add the removal test**

Append to `packages/core/src/cohorts/cohortStore.test.ts` (it now needs
`createPostgresCycleStore` imported, and an `item_types` seed row like the cycle store test's):

```ts
  it("clears participant rows on open cycles but not closed ones", async () => {
    const store = createPostgresCohortStore(pool);
    const cycles = createPostgresCycleStore(pool);
    const cohort = await store.createCohort({ name: "Cabo", createdBy: "u1" });
    await store.addMember(cohort.id, "u2", "member");

    const shared = {
      cohortId: cohort.id,
      startsAt: new Date("2026-09-01T00:00:00Z"),
      endsAt: new Date("2026-09-08T00:00:00Z"),
      itemTypeKeys: ["mango"],
      participantIds: ["u1", "u2"],
      createdBy: "u1",
    };
    const open = await cycles.createCycle({ ...shared, name: "Open" });
    const closed = await cycles.createCycle({ ...shared, name: "Closed" });
    await cycles.closeCycle(closed.id, "u1");

    await store.removeMember(cohort.id, "u2");

    expect((await cycles.getCycle(open.id))?.participantIds).toEqual(["u1"]);
    expect([...((await cycles.getCycle(closed.id))?.participantIds ?? [])].sort())
      .toEqual(["u1", "u2"]);
  });
```

- [ ] **Step 13: Write the barrel and export**

`packages/core/src/cycles/index.ts`:

```ts
export * from "./types.js";
export * from "./cycleStatus.js";
export * from "./cycleStore.js";
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./cycles/index.js";
```

- [ ] **Step 14: Run the full core suite**

Run: `npm run test -w core && npm run typecheck -w core`
Expected: PASS — every test, including Task 1's and Task 2's.

- [ ] **Step 15: Commit**

```bash
git add packages/core/src/cycles packages/core/src/cohorts packages/core/src/db/schema.sql packages/core/src/index.ts
git commit -m "Core: cycles schema, status derivation, and store"
```

---

## Task 4: Core — item type catalog schema and store

**Blocked by:** nothing. Genuinely independent of Task 1 — start the two in parallel. Task 3 depends
on this one, so merge it first.

**Files:**
- Create: `packages/core/src/itemTypes/types.ts`
- Create: `packages/core/src/itemTypes/itemTypeStore.ts`
- Create: `packages/core/src/itemTypes/index.ts`
- Create: `packages/core/src/itemTypes/itemTypeStore.test.ts`
- Modify: `packages/core/src/db/schema.sql` (append two tables)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `ItemType`, `ItemTypeSeed`, `ItemTypeUpdate`, `ItemTypeStore`,
  `createPostgresItemTypeStore(pool)`.

- [ ] **Step 1: Append the schema**

Add to the end of `packages/core/src/db/schema.sql`. `cycle_item_types` lives here rather than in
Task 3 so the foreign key's target table is defined before it is referenced:

```sql
CREATE TABLE IF NOT EXISTS item_types (
  key TEXT PRIMARY KEY,
  emoji TEXT NOT NULL,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

One table, no foreign keys, nothing referencing it yet — which is what makes this task runnable on
its own. The `cycle_item_types` join table belongs to Task 3, since it references `cycles` as well as
`item_types` and `schema.sql` executes top to bottom in one statement.

- [ ] **Step 2: Write the types**

`packages/core/src/itemTypes/types.ts`:

```ts
/** A countable thing a cycle can track. Domain-free by construction: core never
 *  knows what the emoji depicts — the seed data lives in the app layer. */
export interface ItemType {
  key: string;
  emoji: string;
  label: string;
  enabled: boolean;
  position: number;
}

export type ItemTypeSeed = Omit<ItemType, "enabled">;

export interface ItemTypeUpdate {
  enabled?: boolean | undefined;
  label?: string | undefined;
}
```

- [ ] **Step 3: Write the failing test**

`packages/core/src/itemTypes/itemTypeStore.test.ts` — same local-database guard block as Task 1
(error message names `item_types`), then:

```ts
const pool = new Pool({ connectionString });
const store = createPostgresItemTypeStore(pool);

beforeAll(async () => {
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query("DELETE FROM item_types");
});

afterAll(async () => {
  await pool.query("DELETE FROM item_types");
  await pool.end();
});

const SEED = [
  { key: "alpha", emoji: "🅰️", label: "Alpha", position: 0 },
  { key: "beta", emoji: "🅱️", label: "Beta", position: 1 },
];

describe("createPostgresItemTypeStore", () => {
  it("seeds entries and reports how many were inserted", async () => {
    expect(await store.seedItemTypes(SEED)).toBe(2);
    expect((await store.listItemTypes()).map((t) => t.key)).toEqual(["alpha", "beta"]);
  });

  // The whole point of the seed contract: it runs on every deploy and must never
  // stomp the Super Admin's curation.
  it("re-seeding inserts nothing and preserves edits", async () => {
    await store.seedItemTypes(SEED);
    await store.updateItemType("alpha", { enabled: false, label: "Renamed" });

    expect(await store.seedItemTypes(SEED)).toBe(0);

    const alpha = (await store.listItemTypes()).find((t) => t.key === "alpha");
    expect(alpha?.enabled).toBe(false);
    expect(alpha?.label).toBe("Renamed");
  });

  it("filters to enabled entries on request", async () => {
    await store.seedItemTypes(SEED);
    await store.updateItemType("beta", { enabled: false });

    const enabled = await store.listItemTypes({ enabledOnly: true });
    expect(enabled.map((t) => t.key)).toEqual(["alpha"]);
  });

  it("updates only the fields it is given", async () => {
    await store.seedItemTypes(SEED);
    const updated = await store.updateItemType("alpha", { label: "Renamed" });
    expect(updated?.label).toBe("Renamed");
    expect(updated?.enabled).toBe(true);
  });

  it("returns undefined when updating an unknown key", async () => {
    expect(await store.updateItemType("nope", { enabled: false })).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test -w core -- itemTypeStore`
Expected: FAIL — `Cannot find module './itemTypeStore.js'`.

- [ ] **Step 5: Implement the store**

`packages/core/src/itemTypes/itemTypeStore.ts`:

```ts
import type { Pool } from "pg";
import type { ItemType, ItemTypeSeed, ItemTypeUpdate } from "./types.js";

export interface ListItemTypesOptions {
  enabledOnly?: boolean | undefined;
}

export interface ItemTypeStore {
  listItemTypes(options?: ListItemTypesOptions): Promise<ItemType[]>;
  updateItemType(key: string, update: ItemTypeUpdate): Promise<ItemType | undefined>;
  /** Inserts missing entries only. Returns how many rows were actually added. */
  seedItemTypes(entries: ItemTypeSeed[]): Promise<number>;
}

interface ItemTypeRow {
  key: string;
  emoji: string;
  label: string;
  enabled: boolean;
  position: number;
}

const ITEM_TYPE_COLUMNS = "key, emoji, label, enabled, position";

export function createPostgresItemTypeStore(pool: Pool): ItemTypeStore {
  return {
    async listItemTypes(options) {
      const result = await pool.query<ItemTypeRow>(
        `SELECT ${ITEM_TYPE_COLUMNS} FROM item_types
         WHERE ($1::boolean IS NOT TRUE OR enabled)
         ORDER BY position, key`,
        [options?.enabledOnly ?? false],
      );
      return result.rows;
    },

    async updateItemType(key, update) {
      const result = await pool.query<ItemTypeRow>(
        `UPDATE item_types
         SET enabled = COALESCE($2, enabled),
             label = COALESCE($3, label),
             updated_at = now()
         WHERE key = $1
         RETURNING ${ITEM_TYPE_COLUMNS}`,
        [key, update.enabled ?? null, update.label ?? null],
      );
      return result.rows[0];
    },

    // DO NOTHING, never DO UPDATE: this runs on every deploy, and the Super
    // Admin's enable/disable and relabel edits must survive it.
    async seedItemTypes(entries) {
      let inserted = 0;
      for (const entry of entries) {
        const result = await pool.query(
          `INSERT INTO item_types (key, emoji, label, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO NOTHING`,
          [entry.key, entry.emoji, entry.label, entry.position],
        );
        inserted += result.rowCount ?? 0;
      }
      return inserted;
    },
  };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm run test -w core -- itemTypeStore && npm run typecheck -w core`
Expected: PASS, 5 tests.

- [ ] **Step 7: Write the barrel and export**

`packages/core/src/itemTypes/index.ts`:

```ts
export * from "./types.js";
export * from "./itemTypeStore.js";
```

Add to `packages/core/src/index.ts`:

```ts
export * from "./itemTypes/index.js";
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/itemTypes packages/core/src/db/schema.sql packages/core/src/index.ts
git commit -m "Core: item type catalog schema and store"
```

---

## Task 5: Web — emoji catalog seed data, seed script, deploy wiring

**Blocked by:** Task 4 (`ItemTypeSeed`, `createPostgresItemTypeStore`, the `item_types` table).

**Files:**
- Create: `packages/web/src/lib/itemTypeCatalog.ts`
- Create: `packages/web/tests/unit/lib/itemTypeCatalog.test.ts`
- Create: `packages/web/scripts/seed-item-types.ts`
- Modify: `packages/web/package.json` (`seed` script, `vercel-build`, `tsx` devDependency)
- Modify: `README.md` (local setup + deploy notes)

**Interfaces:**
- Consumes: `ItemTypeSeed`, `createPostgresItemTypeStore` from Task 4.
- Produces: `ITEM_TYPE_CATALOG: ItemTypeSeed[]` — Task 15's UI and Task 11's API read the catalog
  from the database, not from this constant; only the seed script imports it.

- [ ] **Step 1: Write the catalog**

`packages/web/src/lib/itemTypeCatalog.ts`. This file is why the catalog seed is a web concern:
`core` may not contain the words below.

```ts
import type { ItemTypeSeed } from "core";

// The Unicode "Food & Drink" group, in code-point order. Lives in `packages/web`
// rather than `core` on purpose: a list containing "Mango" and "Taco" is domain
// data, and root CLAUDE.md forbids those nouns in the domain-agnostic package.
//
// Hand-maintained rather than pulled from an emoji package — this is a fixed
// list that changes once a year at most, and a dependency would have to be
// audited and kept current for no benefit.
const ENTRIES: [emoji: string, label: string][] = [
  ["🍇", "Grapes"], ["🍈", "Melon"], ["🍉", "Watermelon"], ["🍊", "Tangerine"],
  ["🍋", "Lemon"], ["🍌", "Banana"], ["🍍", "Pineapple"], ["🥭", "Mango"],
  ["🍎", "Red apple"], ["🍏", "Green apple"], ["🍐", "Pear"], ["🍑", "Peach"],
  ["🍒", "Cherries"], ["🍓", "Strawberry"], ["🫐", "Blueberries"], ["🥝", "Kiwi"],
  ["🍅", "Tomato"], ["🫒", "Olive"], ["🥥", "Coconut"], ["🥑", "Avocado"],
  ["🍆", "Eggplant"], ["🥔", "Potato"], ["🥕", "Carrot"], ["🌽", "Corn"],
  ["🌶️", "Hot pepper"], ["🫑", "Bell pepper"], ["🥒", "Cucumber"], ["🥬", "Leafy green"],
  ["🥦", "Broccoli"], ["🧄", "Garlic"], ["🧅", "Onion"], ["🥜", "Peanuts"],
  ["🌰", "Chestnut"], ["🍞", "Bread"], ["🥐", "Croissant"], ["🥖", "Baguette"],
  ["🫓", "Flatbread"], ["🥨", "Pretzel"], ["🥯", "Bagel"], ["🥞", "Pancakes"],
  ["🧇", "Waffle"], ["🧀", "Cheese"], ["🍖", "Meat on bone"], ["🍗", "Poultry leg"],
  ["🥩", "Cut of meat"], ["🥓", "Bacon"], ["🍔", "Hamburger"], ["🍟", "Fries"],
  ["🍕", "Pizza"], ["🌭", "Hot dog"], ["🥪", "Sandwich"], ["🌮", "Taco"],
  ["🌯", "Burrito"], ["🫔", "Tamale"], ["🥙", "Stuffed flatbread"], ["🧆", "Falafel"],
  ["🥚", "Egg"], ["🍳", "Cooking"], ["🥘", "Shallow pan of food"], ["🍲", "Pot of food"],
  ["🫕", "Fondue"], ["🥣", "Bowl with spoon"], ["🥗", "Green salad"], ["🍿", "Popcorn"],
  ["🧈", "Butter"], ["🧂", "Salt"], ["🥫", "Canned food"], ["🍱", "Bento box"],
  ["🍘", "Rice cracker"], ["🍙", "Rice ball"], ["🍚", "Cooked rice"], ["🍛", "Curry rice"],
  ["🍜", "Steaming bowl"], ["🍝", "Spaghetti"], ["🍠", "Roasted sweet potato"], ["🍢", "Oden"],
  ["🍣", "Sushi"], ["🍤", "Fried shrimp"], ["🍥", "Fish cake"], ["🥮", "Moon cake"],
  ["🍡", "Dango"], ["🥟", "Dumpling"], ["🥠", "Fortune cookie"], ["🥡", "Takeout box"],
  ["🦪", "Oyster"], ["🍦", "Soft ice cream"], ["🍧", "Shaved ice"], ["🍨", "Ice cream"],
  ["🍩", "Doughnut"], ["🍪", "Cookie"], ["🎂", "Birthday cake"], ["🍰", "Shortcake"],
  ["🧁", "Cupcake"], ["🥧", "Pie"], ["🍫", "Chocolate bar"], ["🍬", "Candy"],
  ["🍭", "Lollipop"], ["🍮", "Custard"], ["🍯", "Honey pot"], ["🍼", "Baby bottle"],
  ["🥛", "Glass of milk"], ["☕", "Hot beverage"], ["🫖", "Teapot"], ["🍵", "Teacup"],
  ["🍶", "Sake"], ["🍾", "Bottle with popping cork"], ["🍷", "Wine glass"], ["🍸", "Cocktail"],
  ["🍹", "Tropical drink"], ["🍺", "Beer mug"], ["🍻", "Clinking beer mugs"], ["🥂", "Clinking glasses"],
  ["🥃", "Tumbler glass"], ["🫗", "Pouring liquid"], ["🥤", "Cup with straw"], ["🧋", "Bubble tea"],
  ["🧃", "Beverage box"], ["🧉", "Mate"], ["🧊", "Ice"],
];

/** `mango` — the default selection in the session form (Task 14). */
export const DEFAULT_ITEM_TYPE_KEY = "mango";

export const ITEM_TYPE_CATALOG: ItemTypeSeed[] = ENTRIES.map(
  ([emoji, label], position) => ({
    key: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    emoji,
    label,
    position,
  }),
);
```

- [ ] **Step 2: Write the catalog test**

`packages/web/tests/unit/lib/itemTypeCatalog.test.ts`. Keys are the primary key of a table seeded on
every deploy, so a duplicate would silently drop an entry forever:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_ITEM_TYPE_KEY, ITEM_TYPE_CATALOG } from "@/lib/itemTypeCatalog";

describe("ITEM_TYPE_CATALOG", () => {
  it("has unique keys", () => {
    const keys = ITEM_TYPE_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entry a key, an emoji, and a label", () => {
    for (const entry of ITEM_TYPE_CATALOG) {
      expect(entry.key).toMatch(/^[a-z0-9-]+$/);
      expect(entry.emoji.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("contains the default selection", () => {
    expect(ITEM_TYPE_CATALOG.some((e) => e.key === DEFAULT_ITEM_TYPE_KEY)).toBe(true);
  });

  it("assigns positions in order with no gaps", () => {
    ITEM_TYPE_CATALOG.forEach((entry, index) => {
      expect(entry.position).toBe(index);
    });
  });
});
```

- [ ] **Step 3: Run it**

Run: `npm run build -w core && npm run test -w web -- itemTypeCatalog`
Expected: PASS, 4 tests. (`core` must be built first — web resolves `core` through its `dist/`.)

- [ ] **Step 4: Write the seed script**

`packages/web/scripts/seed-item-types.ts`, mirroring `packages/core/scripts/migrate.ts`:

```ts
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
```

- [ ] **Step 5: Wire the scripts**

In `packages/web/package.json`, add `tsx` to `devDependencies` (`"tsx": "^4.19.0"`, matching core),
and set:

```json
    "seed": "tsx --env-file-if-exists=../../.env.dev --env-file-if-exists=../../.env scripts/seed-item-types.ts",
    "vercel-build": "npm run build --prefix ../core && npm run migrate --prefix ../core && npm run seed && npm run build",
```

**Why `build --prefix ../core` comes first now:** the seed script imports the `core` package, which
resolves through core's gitignored `dist/`. Before this change `vercel-build` could rely on `prebuild`
to build core, because nothing ran between `migrate` and `build`. The seed step does, so core has to
be built before it. `prebuild` still runs and rebuilds core — `tsc -b` is incremental, so the second
pass is nearly free.

Run `npm install` from the repo root to pick up `tsx`.

- [ ] **Step 6: Verify the seed is idempotent**

```bash
docker compose up -d
npm run build -w core && npm run migrate -w core
npm run seed -w web    # expect: "<N> added, 0 already present."
npm run seed -w web    # expect: "0 added, <N> already present."
```

Then prove an edit survives re-seeding:

```bash
psql "$DATABASE_URL" -c "UPDATE item_types SET enabled = false WHERE key = 'taco'"
npm run seed -w web
psql "$DATABASE_URL" -c "SELECT enabled FROM item_types WHERE key = 'taco'"   # expect: f
```

- [ ] **Step 7: Update the README**

Under the local-setup section, after the existing migrate instruction, add that
`npm run seed -w web` populates the emoji catalog and that **session creation is blocked until it has
run**, because a session must declare at least one enabled item type. In the Deployments section, note
that `vercel-build` now runs build → migrate → seed → build, and that the seed is `ON CONFLICT DO
NOTHING`, so the shared Preview/Production database (issue #27) takes it harmlessly.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/itemTypeCatalog.ts packages/web/tests/unit/lib/itemTypeCatalog.test.ts \
        packages/web/scripts/seed-item-types.ts packages/web/package.json package-lock.json README.md
git commit -m "Web: emoji catalog seed data, seed script, and deploy wiring"
```

---

## Task 6: Web — cohort guard, shared email validator, store wiring

**Blocked by:** Tasks 1, 3, and 4. `db.ts` imports all three store factories, so the web build fails
if any of them is missing — this is a hard dependency, not a "wire it up when it lands."

**Files:**
- Create: `packages/web/src/lib/email.ts`
- Create: `packages/web/src/lib/cohortAuth.ts`
- Create: `packages/web/tests/unit/lib/email.test.ts`
- Create: `packages/web/tests/unit/lib/cohortAuth.test.ts`
- Modify: `packages/web/src/lib/db.ts`
- Modify: `packages/web/src/app/admin/api/users/invite/route.ts` (use the shared validator)

**Interfaces:**
- Consumes: `requireRole` from `@/lib/auth` (shipped), `CohortStore` from Task 1.
- Produces: `isGmailAddress(email: string): boolean`;
  `requireCohortRole(cohortId: string, allowed: CohortRole[], store?: CohortStore): Promise<CohortGuardResult>`
  where `CohortGuardResult = { ok: boolean; status: number; error?: string; clerkUserId?: string;
  platformRole?: Role; cohortRole?: CohortRole }`. **Every route handler in Tasks 7, 8, 10, and 11
  calls one of these two guards as its first statement.**
- Produces: `cohortStore`, `cycleStore`, `itemTypeStore` singletons from `@/lib/db`.

- [ ] **Step 1: Wire the stores**

`packages/web/src/lib/db.ts`:

```ts
import { Pool } from "pg";
import {
  createPostgresCohortStore,
  createPostgresCycleStore,
  createPostgresItemTypeStore,
  createPostgresUserRoleStore,
} from "core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const userRoleStore = createPostgresUserRoleStore(pool);
export const cohortStore = createPostgresCohortStore(pool);
export const cycleStore = createPostgresCycleStore(pool);
export const itemTypeStore = createPostgresItemTypeStore(pool);
```

- [ ] **Step 2: Write the failing email test**

`packages/web/tests/unit/lib/email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isGmailAddress } from "@/lib/email";

describe("isGmailAddress", () => {
  it("accepts a gmail address", () => {
    expect(isGmailAddress("someone@gmail.com")).toBe(true);
  });

  it("is case-insensitive on the domain", () => {
    expect(isGmailAddress("Someone@GMAIL.com")).toBe(true);
  });

  it("rejects other domains", () => {
    expect(isGmailAddress("someone@example.com")).toBe(false);
  });

  it("rejects a domain that merely ends in gmail.com", () => {
    expect(isGmailAddress("someone@notgmail.com")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isGmailAddress("someone")).toBe(false);
    expect(isGmailAddress("")).toBe(false);
    expect(isGmailAddress("a b@gmail.com")).toBe(false);
  });
});
```

- [ ] **Step 3: Extract the validator**

`packages/web/src/lib/email.ts` — the pattern moves verbatim from the invite route, which has had it
inline since Task 8 of v0.1:

```ts
const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

/** Invites are gmail-only (spec: API Surface). Both invite paths call this. */
export function isGmailAddress(email: string): boolean {
  return GMAIL_PATTERN.test(email);
}
```

In `packages/web/src/app/admin/api/users/invite/route.ts`, delete the local `GMAIL_PATTERN` constant,
`import { isGmailAddress } from "@/lib/email";`, and replace `!GMAIL_PATTERN.test(email)` with
`!isGmailAddress(email)`.

- [ ] **Step 4: Run both suites**

Run: `npm run test -w web -- email users-invite`
Expected: PASS — the new email tests, and the shipped invite tests unchanged.

- [ ] **Step 5: Write the failing guard test**

`packages/web/tests/unit/lib/cohortAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: { getMemberRole: vi.fn() },
}));

import { requireRole } from "@/lib/auth";
import { cohortStore } from "@/lib/db";
import { requireCohortRole } from "@/lib/cohortAuth";

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(cohortStore.getMemberRole).mockReset();
});

function platform(role: "owner" | "admin", clerkUserId = "u1") {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, status: 200, role, clerkUserId });
}

describe("requireCohortRole", () => {
  it("passes a group admin", async () => {
    platform("admin");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("admin");
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.ok).toBe(true);
    expect(result.cohortRole).toBe("admin");
  });

  it("rejects a group member where admin is required", async () => {
    platform("admin");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue("member");
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects a platform admin who is not in the group at all", async () => {
    platform("admin");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue(undefined);
    const result = await requireCohortRole("c1", ["admin", "member"]);
    expect(result.status).toBe(403);
  });

  // The Super Admin can always intervene — spec: Authorization.
  it("passes the platform owner even with no membership row", async () => {
    platform("owner", "owner1");
    vi.mocked(cohortStore.getMemberRole).mockResolvedValue(undefined);
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.ok).toBe(true);
    expect(result.platformRole).toBe("owner");
  });

  // The platform gate: /admin/api/* is platform-admin territory, so a plain
  // member who IS in the group still gets nothing here. Their view arrives with
  // the logging slice, on its own surface.
  it("rejects a plain platform member who is a group member", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
      role: "member",
      clerkUserId: "m1",
    });
    const result = await requireCohortRole("c1", ["admin", "member"]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(cohortStore.getMemberRole).not.toHaveBeenCalled();
  });

  it("passes through a 401 when not signed in", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 401,
      error: "Not signed in",
    });
    const result = await requireCohortRole("c1", ["admin"]);
    expect(result.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w web -- cohortAuth`
Expected: FAIL — cannot resolve `@/lib/cohortAuth`.

- [ ] **Step 7: Implement the guard**

`packages/web/src/lib/cohortAuth.ts`:

```ts
import type { CohortRole, CohortStore, Role } from "core";
import { requireRole } from "./auth";
import { cohortStore } from "./db";

export interface CohortGuardResult {
  ok: boolean;
  status: number;
  error?: string | undefined;
  clerkUserId?: string | undefined;
  platformRole?: Role | undefined;
  cohortRole?: CohortRole | undefined;
}

/**
 * The group-scoped half of authorization, in two steps:
 *
 *   1. Platform gate — everything under /admin/api/* is platform-admin territory.
 *   2. Group role — with the platform owner passing unconditionally.
 *
 * Like requireRole, this is called inside each route handler. Route handlers do
 * not run layouts, so app/admin/layout.tsx protects pages only.
 */
export async function requireCohortRole(
  cohortId: string,
  allowed: CohortRole[],
  store: CohortStore = cohortStore,
): Promise<CohortGuardResult> {
  const platform = await requireRole(["owner", "admin"]);
  if (!platform.ok || !platform.clerkUserId || !platform.role) {
    return { ok: false, status: platform.status, error: platform.error };
  }

  const clerkUserId = platform.clerkUserId;
  const cohortRole = await store.getMemberRole(cohortId, clerkUserId);

  if (platform.role === "owner") {
    return {
      ok: true,
      status: 200,
      clerkUserId,
      platformRole: "owner",
      cohortRole,
    };
  }

  if (!cohortRole || !allowed.includes(cohortRole)) {
    return { ok: false, status: 403, error: "Not authorized" };
  }

  return {
    ok: true,
    status: 200,
    clerkUserId,
    platformRole: platform.role,
    cohortRole,
  };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm run test -w web && npm run lint -w web`
Expected: PASS — 6 new guard tests plus every shipped web test.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib packages/web/tests/unit/lib
git commit -m "Web: cohort role guard, shared gmail validator, store wiring"
```

---

## Task 7: Web — groups API (list, create, get, rename)

**Blocked by:** Task 6.

**Files:**
- Create: `packages/web/src/app/admin/api/groups/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/route.ts`
- Create: `packages/web/tests/integration/admin-api/groups.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `requireCohortRole`, `cohortStore`.
- Produces: `GET/POST /admin/api/groups`, `GET/PATCH /admin/api/groups/:groupId`. Response shapes:
  list → `{ groups: { id, name, createdAt }[] }`; detail →
  `{ group: { id, name, createdAt }, members: { clerkUserId, role }[] }`.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/integration/admin-api/groups.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: {
    listCohorts: vi.fn(),
    listCohortsForUser: vi.fn(),
    createCohort: vi.fn(),
    getCohort: vi.fn(),
    renameCohort: vi.fn(),
    listMembers: vi.fn(),
  },
}));

import { requireRole } from "@/lib/auth";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";
import { GET, POST } from "@/app/admin/api/groups/route";
import { GET as GET_ONE, PATCH } from "@/app/admin/api/groups/[groupId]/route";

const COHORT = {
  id: "c1",
  name: "Cabo",
  createdBy: "u1",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

function asPlatform(role: "owner" | "admin", clerkUserId = "u1") {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, status: 200, role, clerkUserId });
}

function asGroup(ok: boolean, status = 200) {
  vi.mocked(requireCohortRole).mockResolvedValue(
    ok
      ? { ok: true, status: 200, clerkUserId: "u1", platformRole: "admin", cohortRole: "admin" }
      : { ok: false, status, error: "Not authorized" },
  );
}

function post(body: unknown) {
  return new Request("http://localhost/admin/api/groups", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireCohortRole).mockReset();
  for (const fn of Object.values(cohortStore)) {
    vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  }
});

describe("GET /admin/api/groups", () => {
  it("returns every group for the owner", async () => {
    asPlatform("owner");
    vi.mocked(cohortStore.listCohorts).mockResolvedValue([COHORT]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      groups: [{ id: "c1", name: "Cabo", createdAt: COHORT.createdAt.toISOString() }],
    });
    expect(cohortStore.listCohortsForUser).not.toHaveBeenCalled();
  });

  it("returns only their own groups for an admin", async () => {
    asPlatform("admin", "a1");
    vi.mocked(cohortStore.listCohortsForUser).mockResolvedValue([]);
    await GET();
    expect(cohortStore.listCohortsForUser).toHaveBeenCalledWith("a1");
    expect(cohortStore.listCohorts).not.toHaveBeenCalled();
  });

  it("passes the guard's rejection through", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    expect((await GET()).status).toBe(403);
  });
});

describe("POST /admin/api/groups", () => {
  it("creates a group with the caller as its admin", async () => {
    asPlatform("admin", "a1");
    vi.mocked(cohortStore.createCohort).mockResolvedValue(COHORT);
    const res = await POST(post({ name: "Cabo" }));
    expect(res.status).toBe(201);
    expect(cohortStore.createCohort).toHaveBeenCalledWith({ name: "Cabo", createdBy: "a1" });
  });

  it("rejects a blank name", async () => {
    asPlatform("admin");
    const res = await POST(post({ name: "   " }));
    expect(res.status).toBe(400);
    expect(cohortStore.createCohort).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    asPlatform("admin");
    const res = await POST(
      new Request("http://localhost/admin/api/groups", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/api/groups/:groupId", () => {
  it("returns the group with its members", async () => {
    asGroup(true);
    vi.mocked(cohortStore.getCohort).mockResolvedValue(COHORT);
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "u1", role: "admin", createdAt: COHORT.createdAt },
    ]);
    const res = await GET_ONE(new Request("http://localhost/admin/api/groups/c1"), {
      params: Promise.resolve({ groupId: "c1" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.group.name).toBe("Cabo");
    expect(body.members).toEqual([{ clerkUserId: "u1", role: "admin" }]);
  });

  it("404s an unknown group", async () => {
    asGroup(true);
    vi.mocked(cohortStore.getCohort).mockResolvedValue(undefined);
    const res = await GET_ONE(new Request("http://localhost/admin/api/groups/nope"), {
      params: Promise.resolve({ groupId: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("403s a non-member", async () => {
    asGroup(false, 403);
    const res = await GET_ONE(new Request("http://localhost/admin/api/groups/c1"), {
      params: Promise.resolve({ groupId: "c1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /admin/api/groups/:groupId", () => {
  it("renames the group", async () => {
    asGroup(true);
    vi.mocked(cohortStore.renameCohort).mockResolvedValue({ ...COHORT, name: "Cabo 2026" });
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Cabo 2026" }),
      }),
      { params: Promise.resolve({ groupId: "c1" }) },
    );
    expect(res.status).toBe(200);
    expect(cohortStore.renameCohort).toHaveBeenCalledWith("c1", "Cabo 2026");
  });

  it("requires the group admin role", async () => {
    asGroup(false, 403);
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Nope" }),
      }),
      { params: Promise.resolve({ groupId: "c1" }) },
    );
    expect(res.status).toBe(403);
    expect(cohortStore.renameCohort).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web -- groups`
Expected: FAIL — cannot resolve `@/app/admin/api/groups/route`.

- [ ] **Step 3: Implement the collection route**

`packages/web/src/app/admin/api/groups/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { Cohort } from "core";
import { requireRole } from "@/lib/auth";
import { cohortStore } from "@/lib/db";

const MAX_NAME_LENGTH = 80;

function toGroupJson(cohort: Cohort) {
  return { id: cohort.id, name: cohort.name, createdAt: cohort.createdAt.toISOString() };
}

export async function GET() {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // The owner administers the whole instance; an admin sees only what they're in.
  const cohorts =
    guard.role === "owner"
      ? await cohortStore.listCohorts()
      : await cohortStore.listCohortsForUser(guard.clerkUserId);

  return NextResponse.json({ groups: cohorts.map(toGroupJson) });
}

export async function POST(request: Request) {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be 1-${MAX_NAME_LENGTH} characters` },
      { status: 400 },
    );
  }

  const cohort = await cohortStore.createCohort({ name, createdBy: guard.clerkUserId });
  return NextResponse.json({ group: toGroupJson(cohort) }, { status: 201 });
}
```

- [ ] **Step 4: Implement the item route**

`packages/web/src/app/admin/api/groups/[groupId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";

const MAX_NAME_LENGTH = 80;

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin", "member"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cohort = await cohortStore.getCohort(groupId);
  if (!cohort) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  const members = await cohortStore.listMembers(groupId);

  return NextResponse.json({
    group: {
      id: cohort.id,
      name: cohort.name,
      createdAt: cohort.createdAt.toISOString(),
    },
    members: members.map((m) => ({ clerkUserId: m.clerkUserId, role: m.role })),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Name must be 1-${MAX_NAME_LENGTH} characters` },
      { status: 400 },
    );
  }

  const cohort = await cohortStore.renameCohort(groupId, name);
  if (!cohort) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
  return NextResponse.json({
    group: {
      id: cohort.id,
      name: cohort.name,
      createdAt: cohort.createdAt.toISOString(),
    },
  });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm run test -w web -- groups && npm run lint -w web`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/admin/api/groups packages/web/tests/integration/admin-api/groups.test.ts
git commit -m "Web: groups API (list, create, get, rename)"
```

---

## Task 8: Web — group members API (add, invite, promote, remove, revoke)

**Blocked by:** Tasks 2 and 6.

**Files:**
- Create: `packages/web/src/app/admin/api/groups/[groupId]/members/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/members/[clerkUserId]/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/invites/[invitationId]/route.ts`
- Create: `packages/web/tests/integration/admin-api/group-members.test.ts`

**Interfaces:**
- Consumes: `requireCohortRole`, `cohortStore`, `userRoleStore`, `wouldRemoveLastCohortAdmin`,
  `isGmailAddress`, Clerk's `clerkClient`.
- Produces: `POST /admin/api/groups/:groupId/members` →
  `{ added: true, clerkUserId }` or `{ invited: true, email }`;
  `PATCH|DELETE /admin/api/groups/:groupId/members/:clerkUserId`;
  `DELETE /admin/api/groups/:groupId/invites/:invitationId`.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/integration/admin-api/group-members.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: {
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
  userRoleStore: { getRole: vi.fn() },
}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, userRoleStore } from "@/lib/db";
import { POST } from "@/app/admin/api/groups/[groupId]/members/route";
import {
  PATCH,
  DELETE,
} from "@/app/admin/api/groups/[groupId]/members/[clerkUserId]/route";

const clerkMock = {
  users: { getUserList: vi.fn() },
  invitations: { createInvitation: vi.fn(), revokeInvitation: vi.fn() },
};

function asGroupAdmin(clerkUserId = "a1") {
  vi.mocked(requireCohortRole).mockResolvedValue({
    ok: true,
    status: 200,
    clerkUserId,
    platformRole: "admin",
    cohortRole: "admin",
  });
}

const groupParams = { params: Promise.resolve({ groupId: "c1" }) };
const memberParams = (clerkUserId: string) => ({
  params: Promise.resolve({ groupId: "c1", clerkUserId }),
});

function addRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/members", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/members/u2", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(requireCohortRole).mockReset();
  vi.mocked(cohortStore.listMembers).mockReset();
  vi.mocked(cohortStore.addMember).mockReset();
  vi.mocked(cohortStore.updateMemberRole).mockReset();
  vi.mocked(cohortStore.removeMember).mockReset();
  vi.mocked(userRoleStore.getRole).mockReset();
  clerkMock.users.getUserList.mockReset();
  clerkMock.invitations.createInvitation.mockReset();
  clerkMock.invitations.revokeInvitation.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("POST /admin/api/groups/:groupId/members", () => {
  it("adds an existing user directly", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [{ id: "u2" }] });
    const res = await POST(addRequest({ email: "friend@gmail.com" }), groupParams);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: true, clerkUserId: "u2" });
    expect(cohortStore.addMember).toHaveBeenCalledWith("c1", "u2", "member");
    expect(clerkMock.invitations.createInvitation).not.toHaveBeenCalled();
  });

  // One door, two outcomes: an unknown email gets a platform invitation that
  // carries the group id, so accepting it lands them in the right group.
  it("invites an unknown email with the group id in metadata", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });
    const res = await POST(addRequest({ email: "new@gmail.com" }), groupParams);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ invited: true, email: "new@gmail.com" });
    expect(clerkMock.invitations.createInvitation).toHaveBeenCalledWith({
      emailAddress: "new@gmail.com",
      publicMetadata: { intendedRole: "member", intendedCohortId: "c1" },
    });
    expect(cohortStore.addMember).not.toHaveBeenCalled();
  });

  it("rejects a non-gmail address before calling Clerk", async () => {
    asGroupAdmin();
    const res = await POST(addRequest({ email: "friend@example.com" }), groupParams);
    expect(res.status).toBe(400);
    expect(clerkMock.users.getUserList).not.toHaveBeenCalled();
  });

  it("surfaces a Clerk failure as 502", async () => {
    asGroupAdmin();
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });
    clerkMock.invitations.createInvitation.mockRejectedValue(new Error("duplicate invitation"));
    const res = await POST(addRequest({ email: "new@gmail.com" }), groupParams);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "duplicate invitation" });
  });
});

describe("PATCH /admin/api/groups/:groupId/members/:clerkUserId", () => {
  const members = [
    { cohortId: "c1", clerkUserId: "a1", role: "admin" as const, createdAt: new Date() },
    { cohortId: "c1", clerkUserId: "u2", role: "member" as const, createdAt: new Date() },
  ];

  it("promotes a platform admin to group admin", async () => {
    asGroupAdmin();
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    vi.mocked(userRoleStore.getRole).mockResolvedValue("admin");
    const res = await PATCH(patchRequest({ role: "admin" }), memberParams("u2"));
    expect(res.status).toBe(200);
    expect(cohortStore.updateMemberRole).toHaveBeenCalledWith("c1", "u2", "admin");
  });

  // The invariant: a group admin who isn't a platform admin can't load the page
  // that administers their group, so the promotion is refused at the source.
  it("refuses to promote a platform member", async () => {
    asGroupAdmin();
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    vi.mocked(userRoleStore.getRole).mockResolvedValue("member");
    const res = await PATCH(patchRequest({ role: "admin" }), memberParams("u2"));
    expect(res.status).toBe(400);
    expect(cohortStore.updateMemberRole).not.toHaveBeenCalled();
  });

  it("blocks demoting the last group admin", async () => {
    asGroupAdmin("owner1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1/members/a1", {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
      }),
      memberParams("a1"),
    );
    expect(res.status).toBe(409);
    expect(cohortStore.updateMemberRole).not.toHaveBeenCalled();
  });

  it("refuses a self role change before parsing the body", async () => {
    asGroupAdmin("a1");
    const res = await PATCH(
      new Request("http://localhost/admin/api/groups/c1/members/a1", {
        method: "PATCH",
        body: "not json",
      }),
      memberParams("a1"),
    );
    expect(res.status).toBe(403);
    expect(cohortStore.listMembers).not.toHaveBeenCalled();
  });

  it("rejects an unknown role value", async () => {
    asGroupAdmin();
    const res = await PATCH(patchRequest({ role: "owner" }), memberParams("u2"));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /admin/api/groups/:groupId/members/:clerkUserId", () => {
  const members = [
    { cohortId: "c1", clerkUserId: "a1", role: "admin" as const, createdAt: new Date() },
    { cohortId: "c1", clerkUserId: "a2", role: "admin" as const, createdAt: new Date() },
  ];

  it("removes a member", async () => {
    asGroupAdmin("a1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    const res = await DELETE(
      new Request("http://localhost/admin/api/groups/c1/members/a2", { method: "DELETE" }),
      memberParams("a2"),
    );
    expect(res.status).toBe(200);
    expect(cohortStore.removeMember).toHaveBeenCalledWith("c1", "a2");
  });

  // Unlike a role change, leaving is allowed — an organizer can walk away from a
  // group they're done with, as long as they don't strand it.
  it("allows self-removal when another admin remains", async () => {
    asGroupAdmin("a1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue(members);
    const res = await DELETE(
      new Request("http://localhost/admin/api/groups/c1/members/a1", { method: "DELETE" }),
      memberParams("a1"),
    );
    expect(res.status).toBe(200);
  });

  it("blocks removing the last admin", async () => {
    asGroupAdmin("a1");
    vi.mocked(cohortStore.listMembers).mockResolvedValue([members[0]!]);
    const res = await DELETE(
      new Request("http://localhost/admin/api/groups/c1/members/a1", { method: "DELETE" }),
      memberParams("a1"),
    );
    expect(res.status).toBe(409);
    expect(cohortStore.removeMember).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web -- group-members`
Expected: FAIL — cannot resolve the member route modules.

- [ ] **Step 3: Implement the add/invite route**

`packages/web/src/app/admin/api/groups/[groupId]/members/route.ts`:

```ts
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore } from "@/lib/db";
import { isGmailAddress } from "@/lib/email";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!isGmailAddress(email)) {
    return NextResponse.json(
      { error: "Email must be a @gmail.com address" },
      { status: 400 },
    );
  }

  const clerk = await clerkClient();
  try {
    const { data: existing } = await clerk.users.getUserList({
      emailAddress: [email],
    });
    const user = existing[0];

    if (user) {
      await cohortStore.addMember(groupId, user.id, "member");
      return NextResponse.json({ added: true, clerkUserId: user.id }, { status: 201 });
    }

    // No local row is pre-created for an invite that may never be accepted —
    // the group id rides along in metadata and is consumed on first sign-in.
    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { intendedRole: "member", intendedCohortId: groupId },
    });
    return NextResponse.json({ invited: true, email }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clerk request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Implement the member item route**

`packages/web/src/app/admin/api/groups/[groupId]/members/[clerkUserId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { wouldRemoveLastCohortAdmin } from "core";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, userRoleStore } from "@/lib/db";

interface RouteContext {
  params: Promise<{ groupId: string; clerkUserId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { groupId, clerkUserId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Checked before the body is parsed, so a malformed body can never override
  // it — same ordering as the shipped platform-role handler.
  if (guard.clerkUserId === clerkUserId) {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 403 },
    );
  }

  let body: { role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const role = body.role;
  if (role !== "admin" && role !== "member") {
    return NextResponse.json({ error: "Role must be admin or member" }, { status: 400 });
  }

  const members = await cohortStore.listMembers(groupId);

  if (role === "admin") {
    const platformRole = await userRoleStore.getRole(clerkUserId);
    if (platformRole !== "admin" && platformRole !== "owner") {
      return NextResponse.json(
        {
          error:
            "Only platform admins can administer a group — ask a Super Admin to promote them first",
        },
        { status: 400 },
      );
    }
  }

  if (wouldRemoveLastCohortAdmin(members, clerkUserId, { type: "role", role })) {
    return NextResponse.json(
      { error: "This group would be left with no admins" },
      { status: 409 },
    );
  }

  await cohortStore.updateMemberRole(groupId, clerkUserId, role);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { groupId, clerkUserId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Self-removal is allowed, unlike a self role change: leaving a group you're
  // done with is legitimate, stranding it is not — the guard below decides.
  const members = await cohortStore.listMembers(groupId);
  if (wouldRemoveLastCohortAdmin(members, clerkUserId, { type: "remove" })) {
    return NextResponse.json(
      { error: "This group would be left with no admins" },
      { status: 409 },
    );
  }

  await cohortStore.removeMember(groupId, clerkUserId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Implement the invite-revoke route**

`packages/web/src/app/admin/api/groups/[groupId]/invites/[invitationId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCohortRole } from "@/lib/cohortAuth";

interface RouteContext {
  params: Promise<{ groupId: string; invitationId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { groupId, invitationId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const clerk = await clerkClient();
  try {
    await clerk.invitations.revokeInvitation(invitationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clerk request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm run test -w web -- group-members && npm run lint -w web`
Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/admin/api/groups packages/web/tests/integration/admin-api/group-members.test.ts
git commit -m "Web: group members API (add, invite, promote, remove, revoke)"
```

---

## Task 9: Web — consume the pending group invitation on first sign-in

**Blocked by:** Task 1.

**Files:**
- Create: `packages/web/src/lib/pendingCohortInvite.ts`
- Create: `packages/web/tests/unit/lib/pendingCohortInvite.test.ts`
- Modify: `packages/web/src/lib/auth.ts` (call it from `getCurrentUserRole`)
- Modify: `packages/web/tests/unit/lib/auth.test.ts` (one new case)

**Interfaces:**
- Consumes: `cohortStore`, Clerk's `clerkClient`.
- Produces: `joinPendingCohort(params: { clerkUserId: string; publicMetadata: Record<string, unknown> }, store?: CohortStore): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/unit/lib/pendingCohortInvite.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ cohortStore: { addMember: vi.fn() } }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { joinPendingCohort } from "@/lib/pendingCohortInvite";

const clerkMock = { users: { updateUser: vi.fn() } };

beforeEach(() => {
  vi.mocked(cohortStore.addMember).mockReset();
  clerkMock.users.updateUser.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("joinPendingCohort", () => {
  it("joins the cohort and clears the metadata", async () => {
    await joinPendingCohort({
      clerkUserId: "u2",
      publicMetadata: { intendedRole: "member", intendedCohortId: "c1" },
    });

    expect(cohortStore.addMember).toHaveBeenCalledWith("c1", "u2", "member");
    expect(clerkMock.users.updateUser).toHaveBeenCalledWith("u2", {
      publicMetadata: { intendedRole: "member", intendedCohortId: null },
    });
  });

  // The whole reason clearing is mandatory: getCurrentUserRole runs on every
  // request, so an uncleared invitation would silently re-add a member an admin
  // had just removed.
  it("does nothing when the metadata carries no cohort id", async () => {
    await joinPendingCohort({
      clerkUserId: "u2",
      publicMetadata: { intendedRole: "member" },
    });

    expect(cohortStore.addMember).not.toHaveBeenCalled();
    expect(clerkMock.users.updateUser).not.toHaveBeenCalled();
  });

  it("ignores a non-string cohort id", async () => {
    await joinPendingCohort({
      clerkUserId: "u2",
      publicMetadata: { intendedCohortId: 42 },
    });
    expect(cohortStore.addMember).not.toHaveBeenCalled();
  });

  // Insert first, clear second: the failure window re-adds on the next request,
  // where the reverse order would drop the membership entirely.
  it("swallows a failure to clear so sign-in still succeeds", async () => {
    clerkMock.users.updateUser.mockRejectedValue(new Error("clerk down"));
    await expect(
      joinPendingCohort({
        clerkUserId: "u2",
        publicMetadata: { intendedCohortId: "c1" },
      }),
    ).resolves.toBeUndefined();
    expect(cohortStore.addMember).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web -- pendingCohortInvite`
Expected: FAIL — cannot resolve `@/lib/pendingCohortInvite`.

- [ ] **Step 3: Implement it**

`packages/web/src/lib/pendingCohortInvite.ts`:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import type { CohortStore } from "core";
import { cohortStore } from "./db";

export interface PendingCohortInviteInput {
  clerkUserId: string;
  publicMetadata: Record<string, unknown>;
}

/**
 * Joins a user to the group their invitation named, then consumes the metadata.
 *
 * Clearing is not bookkeeping — it is the whole mechanism. This runs on every
 * authenticated request via getCurrentUserRole, so an invitation left in place
 * would re-add a member the moment after an admin removed them. resolveRole
 * gets idempotence for free ("an existing row wins"); this does not.
 */
export async function joinPendingCohort(
  input: PendingCohortInviteInput,
  store: CohortStore = cohortStore,
): Promise<void> {
  const cohortId = input.publicMetadata["intendedCohortId"];
  if (typeof cohortId !== "string" || cohortId.length === 0) {
    return;
  }

  await store.addMember(cohortId, input.clerkUserId, "member");

  try {
    const clerk = await clerkClient();
    await clerk.users.updateUser(input.clerkUserId, {
      publicMetadata: { ...input.publicMetadata, intendedCohortId: null },
    });
  } catch {
    // Membership already landed. A failed clear costs one redundant re-add on
    // the next request; failing the whole sign-in over it costs the user access.
  }
}
```

- [ ] **Step 4: Call it from the auth path**

In `packages/web/src/lib/auth.ts`, inside `getCurrentUserRole`, after `resolveRole` returns:

```ts
  await joinPendingCohort({
    clerkUserId: userId,
    publicMetadata: (user.publicMetadata ?? {}) as Record<string, unknown>,
  });

  return { clerkUserId: userId, role };
```

with `import { joinPendingCohort } from "./pendingCohortInvite";` at the top.

- [ ] **Step 5: Run the whole web suite**

Run: `npm run test -w web && npm run lint -w web`
Expected: PASS — the four new tests plus every shipped test, including `auth.test.ts`. If
`auth.test.ts` fails on an unmocked `@/lib/pendingCohortInvite`, add
`vi.mock("@/lib/pendingCohortInvite", () => ({ joinPendingCohort: vi.fn() }))` to it, and one case
asserting `getCurrentUserRole` calls it with the signed-in user's id and metadata.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib packages/web/tests/unit/lib
git commit -m "Web: consume the pending group invitation on first sign-in"
```

---

## Task 10: Web — sessions API (list, create, update, close, reopen)

**Blocked by:** Tasks 3 and 6.

**Files:**
- Create: `packages/web/src/lib/sessions.ts` (validation + JSON shape)
- Create: `packages/web/tests/unit/lib/sessions.test.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/sessions/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/close/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/reopen/route.ts`
- Create: `packages/web/tests/integration/admin-api/group-sessions.test.ts`

**Interfaces:**
- Consumes: `requireCohortRole`, `cohortStore`, `cycleStore`, `itemTypeStore`, `deriveCycleStatus`,
  `isCycleOverdue`.
- Produces: `parseCreateSession`, `parseUpdateSession`, `toSessionJson` from `@/lib/sessions`; the
  four route modules. Session JSON shape (also consumed by Tasks 13 and 14):
  `{ id, name, startsAt, endsAt, status, isOverdue, participantIds, itemTypeKeys }` with ISO strings
  for the dates.

- [ ] **Step 1: Write the failing validation test**

`packages/web/tests/unit/lib/sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCreateSession, parseUpdateSession } from "@/lib/sessions";

const ctx = {
  memberIds: ["u1", "u2"],
  enabledKeys: ["mango", "taco"],
};

const VALID = {
  name: "Beach day",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-08T00:00:00.000Z",
  itemTypeKeys: ["mango"],
  participantIds: ["u1"],
};

describe("parseCreateSession", () => {
  it("accepts a valid payload", () => {
    const result = parseCreateSession(VALID, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Beach day");
      expect(result.value.participantIds).toEqual(["u1"]);
    }
  });

  it("defaults participants to the whole group when omitted", () => {
    const { participantIds: _omitted, ...rest } = VALID;
    const result = parseCreateSession(rest, ctx);
    expect(result.ok && result.value.participantIds).toEqual(["u1", "u2"]);
  });

  // An explicit [] is a mistake, not a request for an empty session: nobody can
  // log against it. Vacuous "every entry is a member" would have passed it.
  it("rejects an explicitly empty participant list", () => {
    const result = parseCreateSession({ ...VALID, participantIds: [] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a participant who is not in the group", () => {
    const result = parseCreateSession({ ...VALID, participantIds: ["stranger"] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty item type list", () => {
    const result = parseCreateSession({ ...VALID, itemTypeKeys: [] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an item type that is unknown or disabled", () => {
    const result = parseCreateSession({ ...VALID, itemTypeKeys: ["margarita"] }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a window that ends before it starts", () => {
    const result = parseCreateSession(
      { ...VALID, startsAt: VALID.endsAt, endsAt: VALID.startsAt },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unparseable date", () => {
    const result = parseCreateSession({ ...VALID, startsAt: "whenever" }, ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a blank name", () => {
    const result = parseCreateSession({ ...VALID, name: "  " }, ctx);
    expect(result.ok).toBe(false);
  });

  it("reports when the catalog has nothing enabled", () => {
    const result = parseCreateSession(VALID, { ...ctx, enabledKeys: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no item types/i);
    }
  });
});

describe("parseUpdateSession", () => {
  const current = {
    startsAt: new Date(VALID.startsAt),
    endsAt: new Date(VALID.endsAt),
  };

  it("accepts a partial payload", () => {
    const result = parseUpdateSession({ name: "Renamed" }, ctx, current);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Renamed");
      expect(result.value.startsAt).toBeUndefined();
    }
  });

  // The merged window is what matters: moving only the end date can still
  // invert a window that was valid before.
  it("checks a new end date against the stored start date", () => {
    const result = parseUpdateSession(
      { endsAt: "2026-08-01T00:00:00.000Z" },
      ctx,
      current,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty participant list on update too", () => {
    const result = parseUpdateSession({ participantIds: [] }, ctx, current);
    expect(result.ok).toBe(false);
  });

  it("accepts an empty object as a no-op", () => {
    expect(parseUpdateSession({}, ctx, current).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web -- sessions`
Expected: FAIL — cannot resolve `@/lib/sessions`.

- [ ] **Step 3: Implement the validation module**

`packages/web/src/lib/sessions.ts`:

```ts
import { deriveCycleStatus, isCycleOverdue, type CycleDetail } from "core";

const MAX_NAME_LENGTH = 80;

export interface SessionContext {
  /** Current members of the owning group — the only legal participants. */
  memberIds: string[];
  /** Keys of enabled catalog entries — disabled ones are picker-invisible. */
  enabledKeys: string[];
}

export interface CreateSessionFields {
  name: string;
  startsAt: Date;
  endsAt: Date;
  itemTypeKeys: string[];
  participantIds: string[];
}

export interface UpdateSessionFields {
  name?: string | undefined;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
  itemTypeKeys?: string[] | undefined;
  participantIds?: string[] | undefined;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function parseName(raw: unknown): ParseResult<string> {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return fail(`Name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  return { ok: true, value: name };
}

function parseDate(raw: unknown, field: string): ParseResult<Date> {
  if (typeof raw !== "string") {
    return fail(`${field} must be an ISO date string`);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return fail(`${field} is not a valid date`);
  }
  return { ok: true, value: date };
}

function parseStringArray(raw: unknown, field: string): ParseResult<string[]> {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return fail(`${field} must be an array of strings`);
  }
  return { ok: true, value: raw as string[] };
}

function checkItemTypes(keys: string[], ctx: SessionContext): string | null {
  if (ctx.enabledKeys.length === 0) {
    return "This instance has no item types enabled — a Super Admin must enable at least one before a session can be created";
  }
  if (keys.length === 0) {
    return "Pick at least one item type";
  }
  const unknown = keys.filter((key) => !ctx.enabledKeys.includes(key));
  return unknown.length > 0
    ? `Unknown or disabled item type: ${unknown.join(", ")}`
    : null;
}

function checkParticipants(ids: string[], ctx: SessionContext): string | null {
  if (ids.length === 0) {
    return "Pick at least one participant";
  }
  const strangers = ids.filter((id) => !ctx.memberIds.includes(id));
  return strangers.length > 0
    ? "Every participant must be a member of this group"
    : null;
}

export function parseCreateSession(
  body: unknown,
  ctx: SessionContext,
): ParseResult<CreateSessionFields> {
  const raw = (body ?? {}) as Record<string, unknown>;

  const name = parseName(raw["name"]);
  if (!name.ok) return name;

  const startsAt = parseDate(raw["startsAt"], "startsAt");
  if (!startsAt.ok) return startsAt;

  const endsAt = parseDate(raw["endsAt"], "endsAt");
  if (!endsAt.ok) return endsAt;

  if (endsAt.value.getTime() <= startsAt.value.getTime()) {
    return fail("The session must end after it starts");
  }

  const itemTypeKeys = parseStringArray(raw["itemTypeKeys"], "itemTypeKeys");
  if (!itemTypeKeys.ok) return itemTypeKeys;
  const itemTypeError = checkItemTypes(itemTypeKeys.value, ctx);
  if (itemTypeError) return fail(itemTypeError);

  // Omitted means "everyone"; an explicit [] means the caller made a mistake.
  let participantIds = ctx.memberIds;
  if (raw["participantIds"] !== undefined) {
    const parsed = parseStringArray(raw["participantIds"], "participantIds");
    if (!parsed.ok) return parsed;
    participantIds = parsed.value;
  }
  const participantError = checkParticipants(participantIds, ctx);
  if (participantError) return fail(participantError);

  return {
    ok: true,
    value: {
      name: name.value,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      itemTypeKeys: itemTypeKeys.value,
      participantIds,
    },
  };
}

export function parseUpdateSession(
  body: unknown,
  ctx: SessionContext,
  current: { startsAt: Date; endsAt: Date },
): ParseResult<UpdateSessionFields> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const value: UpdateSessionFields = {};

  if (raw["name"] !== undefined) {
    const name = parseName(raw["name"]);
    if (!name.ok) return name;
    value.name = name.value;
  }

  if (raw["startsAt"] !== undefined) {
    const startsAt = parseDate(raw["startsAt"], "startsAt");
    if (!startsAt.ok) return startsAt;
    value.startsAt = startsAt.value;
  }

  if (raw["endsAt"] !== undefined) {
    const endsAt = parseDate(raw["endsAt"], "endsAt");
    if (!endsAt.ok) return endsAt;
    value.endsAt = endsAt.value;
  }

  // Validate the window the session will actually have, not the half being sent.
  const mergedStart = value.startsAt ?? current.startsAt;
  const mergedEnd = value.endsAt ?? current.endsAt;
  if (mergedEnd.getTime() <= mergedStart.getTime()) {
    return fail("The session must end after it starts");
  }

  if (raw["itemTypeKeys"] !== undefined) {
    const keys = parseStringArray(raw["itemTypeKeys"], "itemTypeKeys");
    if (!keys.ok) return keys;
    const error = checkItemTypes(keys.value, ctx);
    if (error) return fail(error);
    value.itemTypeKeys = keys.value;
  }

  if (raw["participantIds"] !== undefined) {
    const ids = parseStringArray(raw["participantIds"], "participantIds");
    if (!ids.ok) return ids;
    const error = checkParticipants(ids.value, ctx);
    if (error) return fail(error);
    value.participantIds = ids.value;
  }

  return { ok: true, value };
}

export function toSessionJson(cycle: CycleDetail, now: Date = new Date()) {
  return {
    id: cycle.id,
    name: cycle.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    participantIds: cycle.participantIds,
    itemTypeKeys: cycle.itemTypeKeys,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w web -- sessions`
Expected: PASS, 14 tests.

- [ ] **Step 5: Write the failing route test**

`packages/web/tests/integration/admin-api/group-sessions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cohortAuth", () => ({ requireCohortRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  cohortStore: { listMembers: vi.fn() },
  cycleStore: {
    listCyclesForCohort: vi.fn(),
    createCycle: vi.fn(),
    getCycle: vi.fn(),
    updateCycle: vi.fn(),
    closeCycle: vi.fn(),
    reopenCycle: vi.fn(),
  },
  itemTypeStore: { listItemTypes: vi.fn() },
}));

import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { GET, POST } from "@/app/admin/api/groups/[groupId]/sessions/route";
import { PATCH } from "@/app/admin/api/groups/[groupId]/sessions/[sessionId]/route";
import { POST as CLOSE } from "@/app/admin/api/groups/[groupId]/sessions/[sessionId]/close/route";

const CYCLE = {
  id: "s1",
  cohortId: "c1",
  name: "Beach day",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-08T00:00:00Z"),
  closedAt: null,
  closedBy: null,
  createdBy: "a1",
  createdAt: new Date("2026-08-24T00:00:00Z"),
  updatedAt: new Date("2026-08-24T00:00:00Z"),
  participantIds: ["u1"],
  itemTypeKeys: ["mango"],
};

const groupParams = { params: Promise.resolve({ groupId: "c1" }) };
const sessionParams = { params: Promise.resolve({ groupId: "c1", sessionId: "s1" }) };

function asGroupAdmin() {
  vi.mocked(requireCohortRole).mockResolvedValue({
    ok: true, status: 200, clerkUserId: "a1", platformRole: "admin", cohortRole: "admin",
  });
}

function createRequest(body: unknown) {
  return new Request("http://localhost/admin/api/groups/c1/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Beach day",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-08T00:00:00.000Z",
  itemTypeKeys: ["mango"],
  participantIds: ["u1"],
};

beforeEach(() => {
  vi.mocked(requireCohortRole).mockReset();
  vi.mocked(cohortStore.listMembers).mockReset().mockResolvedValue([
    { cohortId: "c1", clerkUserId: "u1", role: "admin", createdAt: new Date() },
  ]);
  vi.mocked(itemTypeStore.listItemTypes).mockReset().mockResolvedValue([
    { key: "mango", emoji: "🥭", label: "Mango", enabled: true, position: 0 },
  ]);
  for (const fn of Object.values(cycleStore)) {
    vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  }
});

describe("GET /admin/api/groups/:groupId/sessions", () => {
  it("returns sessions with derived status", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.listCyclesForCohort).mockResolvedValue([CYCLE]);
    const res = await GET(new Request("http://localhost/x"), groupParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sessions[0]).toMatchObject({ id: "s1", name: "Beach day" });
    expect(["scheduled", "live", "closed"]).toContain(body.sessions[0].status);
  });

  it("403s a non-member", async () => {
    vi.mocked(requireCohortRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    const res = await GET(new Request("http://localhost/x"), groupParams);
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/api/groups/:groupId/sessions", () => {
  it("creates a session", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.createCycle).mockResolvedValue(CYCLE);
    const res = await POST(createRequest(VALID_BODY), groupParams);
    expect(res.status).toBe(201);
    expect(cycleStore.createCycle).toHaveBeenCalledWith(
      expect.objectContaining({ cohortId: "c1", name: "Beach day", createdBy: "a1" }),
    );
  });

  it("rejects a disabled item type", async () => {
    asGroupAdmin();
    const res = await POST(createRequest({ ...VALID_BODY, itemTypeKeys: ["taco"] }), groupParams);
    expect(res.status).toBe(400);
    expect(cycleStore.createCycle).not.toHaveBeenCalled();
  });

  it("rejects a participant outside the group", async () => {
    asGroupAdmin();
    const res = await POST(
      createRequest({ ...VALID_BODY, participantIds: ["stranger"] }),
      groupParams,
    );
    expect(res.status).toBe(400);
  });

  it("only asks the catalog for enabled entries", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.createCycle).mockResolvedValue(CYCLE);
    await POST(createRequest(VALID_BODY), groupParams);
    expect(itemTypeStore.listItemTypes).toHaveBeenCalledWith({ enabledOnly: true });
  });
});

describe("PATCH and close", () => {
  it("404s a session that belongs to another group", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue({ ...CYCLE, cohortId: "other" });
    const res = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name: "New" }) }),
      sessionParams,
    );
    expect(res.status).toBe(404);
    expect(cycleStore.updateCycle).not.toHaveBeenCalled();
  });

  it("updates a session in its own group", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(cycleStore.updateCycle).mockResolvedValue({ ...CYCLE, name: "Renamed" });
    const res = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
      sessionParams,
    );
    expect(res.status).toBe(200);
    expect(cycleStore.updateCycle).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "Renamed" }));
  });

  it("closes a session, recording who did it", async () => {
    asGroupAdmin();
    vi.mocked(cycleStore.getCycle).mockResolvedValue(CYCLE);
    vi.mocked(cycleStore.closeCycle).mockResolvedValue({
      ...CYCLE, closedAt: new Date("2026-09-09T00:00:00Z"), closedBy: "a1",
    });
    const res = await CLOSE(new Request("http://localhost/x", { method: "POST" }), sessionParams);
    expect(res.status).toBe(200);
    expect(cycleStore.closeCycle).toHaveBeenCalledWith("s1", "a1");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w web -- group-sessions`
Expected: FAIL — cannot resolve the session route modules.

- [ ] **Step 7: Implement the collection route**

`packages/web/src/app/admin/api/groups/[groupId]/sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { parseCreateSession, toSessionJson } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ groupId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin", "member"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cycles = await cycleStore.listCyclesForCohort(groupId);
  const now = new Date();
  return NextResponse.json({ sessions: cycles.map((c) => toSessionJson(c, now)) });
}

export async function POST(request: Request, context: RouteContext) {
  const { groupId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Both lists are read fresh: an admin's picker may be stale, and the catalog
  // can be disabled out from under them between page load and submit.
  const [members, enabled] = await Promise.all([
    cohortStore.listMembers(groupId),
    itemTypeStore.listItemTypes({ enabledOnly: true }),
  ]);

  const parsed = parseCreateSession(body, {
    memberIds: members.map((m) => m.clerkUserId),
    enabledKeys: enabled.map((t) => t.key),
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const cycle = await cycleStore.createCycle({
    cohortId: groupId,
    createdBy: guard.clerkUserId,
    ...parsed.value,
  });
  return NextResponse.json({ session: toSessionJson(cycle) }, { status: 201 });
}
```

- [ ] **Step 8: Implement the item route**

`packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cohortStore, cycleStore, itemTypeStore } from "@/lib/db";
import { parseUpdateSession, toSessionJson } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ groupId: string; sessionId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { groupId, sessionId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // A session id from another group is a 404, not a 403 — the two cases must
  // not be distinguishable by probing.
  const current = await cycleStore.getCycle(sessionId);
  if (!current || current.cohortId !== groupId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [members, enabled] = await Promise.all([
    cohortStore.listMembers(groupId),
    itemTypeStore.listItemTypes({ enabledOnly: true }),
  ]);

  const parsed = parseUpdateSession(
    body,
    {
      memberIds: members.map((m) => m.clerkUserId),
      enabledKeys: enabled.map((t) => t.key),
    },
    { startsAt: current.startsAt, endsAt: current.endsAt },
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await cycleStore.updateCycle(sessionId, parsed.value);
  if (!updated) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ session: toSessionJson(updated) });
}
```

- [ ] **Step 9: Implement close and reopen**

`packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/close/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cycleStore } from "@/lib/db";
import { toSessionJson } from "@/lib/sessions";

interface RouteContext {
  params: Promise<{ groupId: string; sessionId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { groupId, sessionId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const current = await cycleStore.getCycle(sessionId);
  if (!current || current.cohortId !== groupId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const closed = await cycleStore.closeCycle(sessionId, guard.clerkUserId);
  if (!closed) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ session: toSessionJson(closed) });
}
```

`.../reopen/route.ts` is the same file with `closeCycle(sessionId, guard.clerkUserId)` replaced by
`reopenCycle(sessionId)`. Write it out in full rather than importing a shared helper — two short
handlers are clearer than one parameterized one, and they diverge the moment reopening needs an
audit record in the logging slice.

- [ ] **Step 10: Run it to verify it passes**

Run: `npm run test -w web -- group-sessions && npm run lint -w web`
Expected: PASS, 9 tests.

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/lib/sessions.ts packages/web/tests/unit/lib/sessions.test.ts \
        packages/web/src/app/admin/api/groups packages/web/tests/integration/admin-api/group-sessions.test.ts
git commit -m "Web: sessions API (list, create, update, close, reopen)"
```

---

## Task 11: Web — item types API

**Blocked by:** Task 4 (and Task 6 for `requireRole` conventions — no cohort guard needed here).

**Files:**
- Create: `packages/web/src/app/admin/api/item-types/route.ts`
- Create: `packages/web/src/app/admin/api/item-types/[key]/route.ts`
- Create: `packages/web/tests/integration/admin-api/item-types.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `itemTypeStore`.
- Produces: `GET /admin/api/item-types` → `{ itemTypes: ItemType[] }`;
  `PATCH /admin/api/item-types/:key` → `{ itemType: ItemType }`.

- [ ] **Step 1: Write the failing test**

`packages/web/tests/integration/admin-api/item-types.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  itemTypeStore: { listItemTypes: vi.fn(), updateItemType: vi.fn() },
}));

import { requireRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";
import { GET } from "@/app/admin/api/item-types/route";
import { PATCH } from "@/app/admin/api/item-types/[key]/route";

const MANGO = { key: "mango", emoji: "🥭", label: "Mango", enabled: true, position: 0 };

function asRole(role: "owner" | "admin") {
  vi.mocked(requireRole).mockResolvedValue({ ok: true, status: 200, role, clerkUserId: "u1" });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/admin/api/item-types/mango", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const keyParams = { params: Promise.resolve({ key: "mango" }) };

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(itemTypeStore.listItemTypes).mockReset();
  vi.mocked(itemTypeStore.updateItemType).mockReset();
});

describe("GET /admin/api/item-types", () => {
  it("returns the whole catalog to an admin", async () => {
    asRole("admin");
    vi.mocked(itemTypeStore.listItemTypes).mockResolvedValue([MANGO]);
    const res = await GET(new Request("http://localhost/admin/api/item-types"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ itemTypes: [MANGO] });
  });

  it("filters to enabled entries when asked", async () => {
    asRole("admin");
    vi.mocked(itemTypeStore.listItemTypes).mockResolvedValue([MANGO]);
    await GET(new Request("http://localhost/admin/api/item-types?enabled=true"));
    expect(itemTypeStore.listItemTypes).toHaveBeenCalledWith({ enabledOnly: true });
  });
});

describe("PATCH /admin/api/item-types/:key", () => {
  it("lets the owner disable an entry", async () => {
    asRole("owner");
    vi.mocked(itemTypeStore.updateItemType).mockResolvedValue({ ...MANGO, enabled: false });
    const res = await PATCH(patchRequest({ enabled: false }), keyParams);
    expect(res.status).toBe(200);
    expect(itemTypeStore.updateItemType).toHaveBeenCalledWith("mango", { enabled: false });
  });

  // The catalog is platform-wide: one admin's relabel would change every group's
  // sessions, so curation stays with the Super Admin.
  it("refuses a plain admin", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, status: 403, error: "Not authorized" });
    const res = await PATCH(patchRequest({ enabled: false }), keyParams);
    expect(res.status).toBe(403);
    expect(itemTypeStore.updateItemType).not.toHaveBeenCalled();
  });

  it("rejects a body with nothing to change", async () => {
    asRole("owner");
    const res = await PATCH(patchRequest({}), keyParams);
    expect(res.status).toBe(400);
  });

  it("rejects a blank label", async () => {
    asRole("owner");
    const res = await PATCH(patchRequest({ label: "  " }), keyParams);
    expect(res.status).toBe(400);
  });

  it("404s an unknown key", async () => {
    asRole("owner");
    vi.mocked(itemTypeStore.updateItemType).mockResolvedValue(undefined);
    const res = await PATCH(patchRequest({ enabled: true }), keyParams);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web -- item-types`
Expected: FAIL — cannot resolve `@/app/admin/api/item-types/route`.

- [ ] **Step 3: Implement the list route**

`packages/web/src/app/admin/api/item-types/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";

export async function GET(request: Request) {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const enabledOnly = new URL(request.url).searchParams.get("enabled") === "true";
  const itemTypes = await itemTypeStore.listItemTypes(
    enabledOnly ? { enabledOnly: true } : undefined,
  );
  return NextResponse.json({ itemTypes });
}
```

- [ ] **Step 4: Implement the update route**

`packages/web/src/app/admin/api/item-types/[key]/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { ItemTypeUpdate } from "core";
import { requireRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";

const MAX_LABEL_LENGTH = 40;

interface RouteContext {
  params: Promise<{ key: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireRole(["owner"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { key } = await context.params;

  let body: { enabled?: unknown; label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: ItemTypeUpdate = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    update.enabled = body.enabled;
  }

  if (body.label !== undefined) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return NextResponse.json(
        { error: `Label must be 1-${MAX_LABEL_LENGTH} characters` },
        { status: 400 },
      );
    }
    update.label = label;
  }

  if (update.enabled === undefined && update.label === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const itemType = await itemTypeStore.updateItemType(key, update);
  if (!itemType) {
    return NextResponse.json({ error: "Item type not found" }, { status: 404 });
  }
  return NextResponse.json({ itemType });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm run test -w web -- item-types && npm run lint -w web`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/admin/api/item-types packages/web/tests/integration/admin-api/item-types.test.ts
git commit -m "Web: item types API (catalog list, owner-only update)"
```

---

## Task 12: Web — admin nav, groups list page, create-group modal

**Blocked by:** Task 7.

**Files:**
- Create: `packages/web/src/app/admin/AdminNav.tsx`
- Create: `packages/web/src/app/admin/groups/page.tsx`
- Create: `packages/web/src/app/admin/groups/GroupsTable.tsx`
- Create: `packages/web/src/app/admin/groups/NewGroupModal.tsx`
- Modify: `packages/web/src/app/admin/layout.tsx` (render the nav)

`admin/page.tsx` is not touched — the nav renders links, not a page heading, so its `<h1>Users</h1>`
stays.

**Interfaces:**
- Consumes: `getCurrentUserRole`, `cohortStore`, `POST /admin/api/groups`.
- Produces: `<AdminNav currentRole={role} />` — Task 15 adds the Item types link behind an
  owner-only branch inside it.

- [ ] **Step 1: Write the nav**

`packages/web/src/app/admin/AdminNav.tsx` — a server component, no interactivity:

```tsx
import Link from "next/link";
import type { Role } from "core";

// Owner-only links are hidden here AND 403'd server-side in their own pages.
// Hiding alone is not authorization.
export function AdminNav({ currentRole }: { currentRole: Role }) {
  return (
    <nav className="border-b border-gray-200">
      <div className="mx-auto flex w-full max-w-3xl gap-4 px-6 py-3 text-sm">
        <Link href="/admin" className="hover:underline">
          Users
        </Link>
        <Link href="/admin/groups" className="hover:underline">
          Groups
        </Link>
        {currentRole === "owner" && (
          <Link href="/admin/item-types" className="hover:underline">
            Item types
          </Link>
        )}
      </div>
    </nav>
  );
}
```

In `packages/web/src/app/admin/layout.tsx`, wrap the authorized branch:

```tsx
  return (
    <>
      <AdminNav currentRole={current.role} />
      {children}
    </>
  );
```

- [ ] **Step 2: Write the groups page**

`packages/web/src/app/admin/groups/page.tsx` — a server component reading the store directly, the
pattern `admin/page.tsx` established (no HTTP round-trip to our own route handler):

```tsx
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore } from "@/lib/db";
import { GroupsTable, type GroupView } from "./GroupsTable";

const CREATED_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function GroupsPage() {
  const current = await getCurrentUserRole();
  // Unreachable: admin/layout.tsx redirects when this is null. A real branch
  // rather than a non-null assertion, matching admin/page.tsx.
  if (!current) {
    return null;
  }

  const cohorts =
    current.role === "owner"
      ? await cohortStore.listCohorts()
      : await cohortStore.listCohortsForUser(current.clerkUserId);

  const rows: GroupView[] = await Promise.all(
    cohorts.map(async (cohort) => ({
      id: cohort.id,
      name: cohort.name,
      created: CREATED_FMT.format(cohort.createdAt),
      memberCount: (await cohortStore.listMembers(cohort.id)).length,
    })),
  );

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Groups</h1>
      <GroupsTable initialGroups={rows} />
    </div>
  );
}
```

- [ ] **Step 3: Write the table and modal**

`packages/web/src/app/admin/groups/GroupsTable.tsx` — `"use client"`, owns the modal and the
post-create refresh:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { NewGroupModal } from "./NewGroupModal";

export interface GroupView {
  id: string;
  name: string;
  created: string;
  memberCount: number;
}

export function GroupsTable({ initialGroups }: { initialGroups: GroupView[] }) {
  const router = useRouter();
  const [isModalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded bg-black px-3 py-1.5 text-sm text-white"
        >
          New group
        </button>
      </div>

      {initialGroups.length === 0 ? (
        <p className="text-sm text-gray-500">
          No groups yet. Create one to start setting up sessions.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2">Name</th>
              <th className="py-2">Members</th>
              <th className="py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {initialGroups.map((group) => (
              <tr key={group.id} className="border-b border-gray-100">
                <td className="py-2">
                  <Link href={`/admin/groups/${group.id}`} className="hover:underline">
                    {group.name}
                  </Link>
                </td>
                <td className="py-2">{group.memberCount}</td>
                <td className="py-2 text-gray-500">{group.created}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isModalOpen && (
        <NewGroupModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            // The server component owns the list; re-render it rather than
            // duplicating group state on the client.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
```

`packages/web/src/app/admin/groups/NewGroupModal.tsx` — `"use client"`, mirroring
`InviteUserModal.tsx`'s structure (name input, submit, surfaced server error):

```tsx
"use client";

import { useState } from "react";

export function NewGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/admin/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create the group");
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-3 rounded bg-white p-5"
      >
        <h2 className="text-lg font-semibold">New group</h2>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds and lints**

Run: `npm run build -w core && npm run lint -w web && npm run build -w web`
Expected: no errors.

- [ ] **Step 5: Verify manually**

```bash
docker compose up -d
npm run migrate -w core && npm run seed -w web
npm run dev -w web
```

As the Super Admin: `/admin` shows the nav with Users, Groups, and Item types; `/admin/groups` shows
the empty state; create "Cabo" and confirm the row appears with 1 member and today's date; click
through to `/admin/groups/<id>` and expect a 404 for now (Task 13 adds the page).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/admin
git commit -m "Web: admin nav, groups list, and create-group modal"
```

---

## Task 13: Web — group detail page (members, invites, sessions)

**Blocked by:** Tasks 8, 10, 12.

**Files:**
- Create: `packages/web/src/lib/adminGroups.ts`
- Create: `packages/web/tests/unit/lib/adminGroups.test.ts`
- Create: `packages/web/src/app/admin/groups/[groupId]/page.tsx`
- Create: `packages/web/src/app/admin/groups/[groupId]/MembersPanel.tsx`
- Create: `packages/web/src/app/admin/groups/[groupId]/SessionsPanel.tsx`

**Interfaces:**
- Consumes: every route handler from Tasks 8 and 10, `cohortStore`, `cycleStore`, `clerkClient`.
- Produces: `listGroupMembersForAdmin(groupId, store?)` → `GroupMemberView[]`
  (`{ clerkUserId, email, name, avatarUrl, role }`), and
  `listPendingGroupInvites(groupId)` → `{ id, email }[]`.

- [ ] **Step 1: Write the failing helper test**

`packages/web/tests/unit/lib/adminGroups.test.ts`, mirroring the shipped `adminUsers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@/lib/db", () => ({ cohortStore: { listMembers: vi.fn() } }));

import { clerkClient } from "@clerk/nextjs/server";
import { cohortStore } from "@/lib/db";
import { listGroupMembersForAdmin, listPendingGroupInvites } from "@/lib/adminGroups";

const clerkMock = {
  users: { getUserList: vi.fn() },
  invitations: { getInvitationList: vi.fn() },
};

beforeEach(() => {
  vi.mocked(cohortStore.listMembers).mockReset();
  clerkMock.users.getUserList.mockReset();
  clerkMock.invitations.getInvitationList.mockReset();
  vi.mocked(clerkClient).mockResolvedValue(clerkMock as never);
});

describe("listGroupMembersForAdmin", () => {
  it("joins group roles onto Clerk identities", async () => {
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "u1", role: "admin", createdAt: new Date() },
    ]);
    clerkMock.users.getUserList.mockResolvedValue({
      data: [
        {
          id: "u1",
          firstName: "Dave",
          lastName: null,
          imageUrl: "https://img/1",
          primaryEmailAddress: { emailAddress: "dave@gmail.com" },
        },
      ],
    });

    const rows = await listGroupMembersForAdmin("c1");
    expect(rows).toEqual([
      {
        clerkUserId: "u1",
        email: "dave@gmail.com",
        name: "Dave",
        avatarUrl: "https://img/1",
        role: "admin",
      },
    ]);
  });

  // A membership row whose Clerk user has been deleted must not vanish silently
  // — it still counts toward the admin count the guards read.
  it("keeps a member Clerk no longer knows", async () => {
    vi.mocked(cohortStore.listMembers).mockResolvedValue([
      { cohortId: "c1", clerkUserId: "ghost", role: "member", createdAt: new Date() },
    ]);
    clerkMock.users.getUserList.mockResolvedValue({ data: [] });

    const rows = await listGroupMembersForAdmin("c1");
    expect(rows[0]).toMatchObject({ clerkUserId: "ghost", email: null, name: null });
  });
});

describe("listPendingGroupInvites", () => {
  it("returns only invitations tagged for this group", async () => {
    clerkMock.invitations.getInvitationList.mockResolvedValue({
      data: [
        { id: "i1", emailAddress: "new@gmail.com", publicMetadata: { intendedCohortId: "c1" } },
        { id: "i2", emailAddress: "other@gmail.com", publicMetadata: { intendedCohortId: "c2" } },
        { id: "i3", emailAddress: "plain@gmail.com", publicMetadata: {} },
      ],
    });

    const invites = await listPendingGroupInvites("c1");
    expect(invites).toEqual([{ id: "i1", email: "new@gmail.com" }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web -- adminGroups`
Expected: FAIL — cannot resolve `@/lib/adminGroups`.

- [ ] **Step 3: Implement the helper**

`packages/web/src/lib/adminGroups.ts`:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import type { CohortRole, CohortStore } from "core";
import { cohortStore } from "./db";

export interface GroupMemberView {
  clerkUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: CohortRole;
}

export interface PendingInviteView {
  id: string;
  email: string;
}

export async function listGroupMembersForAdmin(
  groupId: string,
  store: CohortStore = cohortStore,
): Promise<GroupMemberView[]> {
  const members = await store.listMembers(groupId);
  if (members.length === 0) {
    return [];
  }

  const clerk = await clerkClient();
  const { data: users } = await clerk.users.getUserList({
    userId: members.map((m) => m.clerkUserId),
    limit: members.length,
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  // Membership rows are the source of truth for who is in the group; Clerk only
  // decorates them. A row with no Clerk user still shows, still counts.
  return members.map((member) => {
    const user = byId.get(member.clerkUserId);
    return {
      clerkUserId: member.clerkUserId,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      name: user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null : null,
      avatarUrl: user?.imageUrl ?? null,
      role: member.role,
    };
  });
}

export async function listPendingGroupInvites(
  groupId: string,
): Promise<PendingInviteView[]> {
  const clerk = await clerkClient();
  const { data } = await clerk.invitations.getInvitationList({ status: "pending" });
  return data
    .filter((invitation) => invitation.publicMetadata?.["intendedCohortId"] === groupId)
    .map((invitation) => ({ id: invitation.id, email: invitation.emailAddress }));
}
```

- [ ] **Step 4: Write the page**

`packages/web/src/app/admin/groups/[groupId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { deriveCycleStatus, isCycleOverdue } from "core";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, cycleStore } from "@/lib/db";
import { listGroupMembersForAdmin, listPendingGroupInvites } from "@/lib/adminGroups";
import { MembersPanel } from "./MembersPanel";
import { SessionsPanel, type SessionView } from "./SessionsPanel";

const WINDOW_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  const group = await cohortStore.getCohort(groupId);
  if (!group) {
    notFound();
  }

  // The page gate mirrors requireCohortRole's second step; the layout has
  // already applied its first (platform owner/admin only).
  const myRole = await cohortStore.getMemberRole(groupId, current.clerkUserId);
  const canManage = current.role === "owner" || myRole === "admin";
  if (!myRole && current.role !== "owner") {
    notFound();
  }

  const [members, invites, cycles] = await Promise.all([
    listGroupMembersForAdmin(groupId),
    listPendingGroupInvites(groupId),
    cycleStore.listCyclesForCohort(groupId),
  ]);

  const now = new Date();
  const sessions: SessionView[] = cycles.map((cycle) => ({
    id: cycle.id,
    name: cycle.name,
    window: `${WINDOW_FMT.format(cycle.startsAt)} – ${WINDOW_FMT.format(cycle.endsAt)}`,
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    participantCount: cycle.participantIds.length,
    itemTypeKeys: cycle.itemTypeKeys,
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">{group.name}</h1>
      <MembersPanel
        groupId={groupId}
        initialMembers={members}
        initialInvites={invites}
        canManage={canManage}
        currentUserId={current.clerkUserId}
      />
      <SessionsPanel groupId={groupId} sessions={sessions} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 5: Write the panels**

`MembersPanel.tsx` (`"use client"`) renders the member table with a role `<select>` per row, a
Remove button, the pending-invite list with Revoke, and an add-by-email form. Every mutation follows
the shipped `AdminUserTable` interaction model:

- The signed-in user's own **role select is disabled** — the API rejects self role changes with 403.
- Their **Remove button stays enabled** — self-removal is allowed unless they are the last admin, and
  the API's 409 is what says so.
- On failure, show `body.error` from the response and call `router.refresh()` so the row returns to
  server truth rather than a guessed rollback.

```tsx
  async function changeRole(clerkUserId: string, role: "admin" | "member") {
    const res = await fetch(`/admin/api/groups/${groupId}/members/${clerkUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not change the role");
    }
    router.refresh();
  }
```

`removeMember` and `revokeInvite` are the same shape against
`DELETE /admin/api/groups/:groupId/members/:clerkUserId` and
`DELETE /admin/api/groups/:groupId/invites/:invitationId`. `addMember` POSTs `{ email }` to
`/admin/api/groups/:groupId/members`, validates with `isGmailAddress` before submitting, and
distinguishes the two success shapes in its confirmation copy: `added` → "Added to the group",
`invited` → "Invitation sent".

`SessionsPanel.tsx` is read-plus-navigate only: a table of sessions with a status badge (`scheduled`
/ `live` / `closed`, plus an "ended — needs closing" marker when `isOverdue`), the item emoji, the
participant count, a link to each session's page, and a "New session" link to
`/admin/groups/<id>/sessions/new` (Task 14). Guard both write affordances behind `canManage`.

- [ ] **Step 6: Run everything**

Run: `npm run test -w web && npm run lint -w web && npm run build -w web`
Expected: PASS.

- [ ] **Step 7: Verify manually**

With the dev server running, as the Super Admin: open a group, add an existing user's gmail address
and see them appear as a member; add an unknown gmail address and see it appear under pending invites;
revoke it and see it disappear. Promote a platform Admin to group admin and confirm it succeeds; try
promoting a platform Member and confirm the 400 message appears. Try demoting the only admin and
confirm the 409 message appears and the row does not change.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/adminGroups.ts packages/web/tests/unit/lib/adminGroups.test.ts \
        packages/web/src/app/admin/groups
git commit -m "Web: group detail page with members, invites, and sessions"
```

---

## Task 14: Web — session create and detail pages

**Blocked by:** Tasks 10, 11, 13.

**Files:**
- Create: `packages/web/src/app/admin/groups/[groupId]/sessions/new/page.tsx`
- Create: `packages/web/src/app/admin/groups/[groupId]/sessions/[sessionId]/page.tsx`
- Create: `packages/web/src/app/admin/groups/[groupId]/sessions/SessionForm.tsx`
- Create: `packages/web/src/app/admin/groups/[groupId]/sessions/EmojiPicker.tsx`

**Interfaces:**
- Consumes: `POST /admin/api/groups/:groupId/sessions`,
  `PATCH|close|reopen /admin/api/groups/:groupId/sessions/:sessionId`, `itemTypeStore`,
  `listGroupMembersForAdmin` (Task 13), `DEFAULT_ITEM_TYPE_KEY` (Task 5).
- Produces: `<SessionForm mode="create" | "edit" ... />` — the single form both pages render.

- [ ] **Step 1: Write the shared form**

`SessionForm.tsx` (`"use client"`). One component for both pages: the fields are identical and the
only differences are the endpoint and the presence of the close/reopen control.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmojiPicker } from "./EmojiPicker";

export interface ItemTypeOption {
  key: string;
  emoji: string;
  label: string;
}

export interface MemberOption {
  clerkUserId: string;
  name: string;
}

export interface SessionFormProps {
  groupId: string;
  itemTypes: ItemTypeOption[];
  members: MemberOption[];
  canManage: boolean;
  session?: {
    id: string;
    name: string;
    startsAt: string;   // "YYYY-MM-DDTHH:mm", datetime-local shape
    endsAt: string;
    status: "scheduled" | "live" | "closed";
    isOverdue: boolean;
    itemTypeKeys: string[];
    participantIds: string[];
  };
  defaultItemTypeKey: string;
}

export function SessionForm(props: SessionFormProps) {
  const router = useRouter();
  const isEdit = props.session !== undefined;

  const [name, setName] = useState(props.session?.name ?? "");
  const [startsAt, setStartsAt] = useState(props.session?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(props.session?.endsAt ?? "");
  const [itemTypeKeys, setItemTypeKeys] = useState<string[]>(
    props.session?.itemTypeKeys ?? [props.defaultItemTypeKey],
  );
  const [participantIds, setParticipantIds] = useState<string[]>(
    props.session?.participantIds ?? props.members.map((m) => m.clerkUserId),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Client-side mirrors of the two server rules most likely to be hit, so the
    // common mistake never costs a round trip. The server re-checks regardless.
    if (itemTypeKeys.length === 0) {
      setError("Pick at least one item type");
      return;
    }
    if (participantIds.length === 0) {
      setError("Pick at least one participant");
      return;
    }

    setSubmitting(true);
    try {
      const url = isEdit
        ? `/admin/api/groups/${props.groupId}/sessions/${props.session!.id}`
        : `/admin/api/groups/${props.groupId}/sessions`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          // datetime-local has no timezone; the browser's zone is what the admin
          // means by "3pm", so convert here rather than sending a bare string.
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          itemTypeKeys,
          participantIds,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not save the session");
        return;
      }
      const body = await res.json();
      router.push(`/admin/groups/${props.groupId}/sessions/${body.session.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function setClosed(closed: boolean) {
    setError(null);
    const action = closed ? "close" : "reopen";
    const res = await fetch(
      `/admin/api/groups/${props.groupId}/sessions/${props.session!.id}/${action}`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not ${action} the session`);
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {props.session?.isOverdue && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This session passed its end time and is still open. Close it when the
          group is done logging.
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          disabled={!props.canManage}
          className="rounded border border-gray-300 px-2 py-1"
        />
      </label>

      <div className="flex gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Starts
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            disabled={!props.canManage}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Ends
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
            disabled={!props.canManage}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
      </div>

      <EmojiPicker
        options={props.itemTypes}
        selected={itemTypeKeys}
        disabled={!props.canManage}
        onChange={setItemTypeKeys}
      />

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1">Participants</legend>
        {props.members.map((member) => (
          <label key={member.clerkUserId} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={participantIds.includes(member.clerkUserId)}
              disabled={!props.canManage}
              onChange={(e) =>
                setParticipantIds((ids) =>
                  e.target.checked
                    ? [...ids, member.clerkUserId]
                    : ids.filter((id) => id !== member.clerkUserId),
                )
              }
            />
            {member.name}
          </label>
        ))}
      </fieldset>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {props.canManage && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {isEdit ? "Save" : "Create session"}
          </button>
          {isEdit && props.session!.status !== "closed" && (
            <button
              type="button"
              onClick={() => setClosed(true)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              Close session
            </button>
          )}
          {isEdit && props.session!.status === "closed" && (
            <button
              type="button"
              onClick={() => setClosed(false)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              Reopen session
            </button>
          )}
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Write the emoji picker**

`EmojiPicker.tsx` (`"use client"`) — a toggle grid, not a `<select multiple>`, because the emoji is
the whole point of the choice:

```tsx
"use client";

import type { ItemTypeOption } from "./SessionForm";

export function EmojiPicker({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: ItemTypeOption[];
  selected: string[];
  disabled: boolean;
  onChange: (keys: string[]) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
        No item types are enabled. A Super Admin must enable at least one on the
        Item types page before a session can be created.
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1">What this session tracks</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const isSelected = selected.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              title={option.label}
              aria-pressed={isSelected}
              onClick={() =>
                onChange(
                  isSelected
                    ? selected.filter((key) => key !== option.key)
                    : [...selected, option.key],
                )
              }
              className={`rounded border px-2 py-1 text-lg ${
                isSelected ? "border-black bg-gray-100" : "border-gray-200"
              }`}
            >
              <span aria-hidden="true">{option.emoji}</span>
              <span className="sr-only">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 3: Write the two pages**

Both are server components that load the same three things — enabled item types, group members, and
(for edit) the session — then render `SessionForm`.

`sessions/new/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";
import { cohortStore, itemTypeStore } from "@/lib/db";
import { listGroupMembersForAdmin } from "@/lib/adminGroups";
import { DEFAULT_ITEM_TYPE_KEY } from "@/lib/itemTypeCatalog";
import { SessionForm } from "../SessionForm";

export default async function NewSessionPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  const myRole = await cohortStore.getMemberRole(groupId, current.clerkUserId);
  const canManage = current.role === "owner" || myRole === "admin";
  if (!canManage) {
    notFound();
  }

  const [itemTypes, members] = await Promise.all([
    itemTypeStore.listItemTypes({ enabledOnly: true }),
    listGroupMembersForAdmin(groupId),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">New session</h1>
      <SessionForm
        groupId={groupId}
        canManage
        defaultItemTypeKey={DEFAULT_ITEM_TYPE_KEY}
        itemTypes={itemTypes.map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }))}
        members={members.map((m) => ({
          clerkUserId: m.clerkUserId,
          name: m.name ?? m.email ?? m.clerkUserId,
        }))}
      />
    </div>
  );
}
```

`sessions/[sessionId]/page.tsx` is the same, plus: load the cycle via `cycleStore.getCycle`, **404 if
`cycle.cohortId !== groupId`** (the same rule the API enforces), and pass a `session` prop. Convert
the stored `Date`s to the `"YYYY-MM-DDTHH:mm"` shape `datetime-local` requires:

```tsx
function toLocalInputValue(date: Date): string {
  // datetime-local wants local wall-clock with no zone suffix. Rendering on the
  // server would use the server's zone, so this runs in a client component —
  // pass the ISO string down and convert there, or accept UTC and label it.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
```

**Pick one and be consistent:** either render the inputs in UTC and label them "UTC" (matching how
`admin/page.tsx` formats joined dates on the server to avoid hydration mismatch), or move the
conversion into `SessionForm` with a `useEffect`. The simplest correct choice for this slice is UTC
with an explicit label — a session's window is group-wide, and an admin setting one up for a trip is
better served by an unambiguous label than by a silent local-time guess.

- [ ] **Step 4: Run everything**

Run: `npm run test -w web && npm run lint -w web && npm run build -w web`
Expected: PASS.

- [ ] **Step 5: Verify manually**

Create a session with two emoji and a subset of participants; confirm it appears on the group page
with the right badge. Edit it, remove one emoji, save, reload — the change persists. Set the end time
in the past and reload: the "ended, still open" banner appears and the status is still `live`. Close
it; the badge becomes `closed` and the button becomes Reopen. Reopen it and confirm it returns to
`live`. Finally, disable every item type from `/admin/item-types` (Task 15) and confirm the new
session page explains itself instead of rendering an unusable empty picker.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/admin/groups
git commit -m "Web: session create and detail pages with emoji picker"
```

---

## Task 15: Web — owner-only item types page

**Blocked by:** Tasks 11, 12.

**Files:**
- Create: `packages/web/src/app/admin/item-types/page.tsx`
- Create: `packages/web/src/app/admin/item-types/ItemTypeTable.tsx`

**Interfaces:**
- Consumes: `getCurrentUserRole`, `itemTypeStore`, `PATCH /admin/api/item-types/:key`.

- [ ] **Step 1: Write the page**

`packages/web/src/app/admin/item-types/page.tsx` — the nav hides this link from admins, but hiding is
not authorization, so the page checks the role itself:

```tsx
import { getCurrentUserRole } from "@/lib/auth";
import { itemTypeStore } from "@/lib/db";
import { ItemTypeTable } from "./ItemTypeTable";

export default async function ItemTypesPage() {
  const current = await getCurrentUserRole();
  if (!current) {
    return null;
  }

  // The nav hides this link for admins; this is the gate that enforces it.
  if (current.role !== "owner") {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-gray-500">
          Only a Super Admin can curate the item type catalog.
        </p>
      </div>
    );
  }

  const itemTypes = await itemTypeStore.listItemTypes();

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-semibold">Item types</h1>
      <p className="mb-4 text-sm text-gray-500">
        Disabled entries disappear from the session picker. Sessions that already
        use one keep working.
      </p>
      <ItemTypeTable initialItemTypes={itemTypes} />
    </div>
  );
}
```

- [ ] **Step 2: Write the table**

`ItemTypeTable.tsx` (`"use client"`): one row per entry with the emoji, an editable label (saved on
blur), and an enabled checkbox. Both call
`PATCH /admin/api/item-types/:key` with only the changed field, then `router.refresh()`. On failure,
surface `body.error` and refresh so the row returns to server truth.

```tsx
  async function patch(key: string, update: { enabled?: boolean; label?: string }) {
    const res = await fetch(`/admin/api/item-types/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not update the item type");
    }
    router.refresh();
  }
```

With ~130 rows the list is long; render it as a plain table with a text filter input that narrows by
label. No pagination — it is a fixed-size list and a filter box is less machinery than paging.

- [ ] **Step 3: Run everything**

Run: `npm run test -w web && npm run lint -w web && npm run build -w web`
Expected: PASS.

- [ ] **Step 4: Verify manually**

As the Super Admin, disable 🌮 and confirm it vanishes from the session picker while a session that
already uses it still shows the emoji. Rename an entry and confirm the new label appears in the
picker's tooltip. Sign in as a plain Admin and confirm the Item types link is absent from the nav and
that visiting `/admin/item-types` directly renders the not-authorized page.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/admin/item-types
git commit -m "Web: owner-only item types catalog page"
```

---

## Task 16: Web — hold the platform-admin invariant on demotion

**Blocked by:** Tasks 1 and 2. **Modifies code and tests shipped in v0.1.**

**Files:**
- Modify: `packages/web/src/app/admin/api/users/[clerkUserId]/role/route.ts`
- Modify: `packages/web/tests/integration/admin-api/users-role.test.ts`

**Interfaces:**
- Consumes: `cohortStore.listAdminMembershipsForUser`, `cohortStore.demoteAdminMemberships`
  (both from Task 1).

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/tests/integration/admin-api/users-role.test.ts`. The existing `vi.mock("@/lib/db", …)`
factory gains `cohortStore: { listAdminMembershipsForUser: vi.fn(), demoteAdminMemberships: vi.fn() }`,
and the `beforeEach` resets both:

```ts
  // The invariant has two write paths, and this is the one v0.1 never knew about:
  // demoting a platform admin who is a group's only admin would leave that group
  // with an admin row that grants nothing, reachable by nobody but the owner.
  it("blocks demoting the last admin of a group", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, status: 200, role: "owner", clerkUserId: "owner1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      { clerkUserId: "owner1", role: "owner", createdAt: new Date(), updatedAt: new Date() },
      { clerkUserId: "u1", role: "admin", createdAt: new Date(), updatedAt: new Date() },
    ]);
    vi.mocked(cohortStore.listAdminMembershipsForUser).mockResolvedValue([
      { cohortId: "c1", cohortName: "Cabo", adminCount: 1 },
    ]);

    const res = await PATCH(makeRequest({ role: "member" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Cabo");
    expect(userRoleStore.upsertRole).not.toHaveBeenCalled();
  });

  it("cascades group admin roles when another admin remains", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, status: 200, role: "owner", clerkUserId: "owner1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      { clerkUserId: "owner1", role: "owner", createdAt: new Date(), updatedAt: new Date() },
      { clerkUserId: "u1", role: "admin", createdAt: new Date(), updatedAt: new Date() },
    ]);
    vi.mocked(cohortStore.listAdminMembershipsForUser).mockResolvedValue([
      { cohortId: "c1", cohortName: "Cabo", adminCount: 2 },
    ]);

    const res = await PATCH(makeRequest({ role: "member" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });

    expect(res.status).toBe(200);
    expect(userRoleStore.upsertRole).toHaveBeenCalledWith("u1", "member");
    expect(cohortStore.demoteAdminMemberships).toHaveBeenCalledWith("u1");
  });

  it("leaves group memberships alone when promoting", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true, status: 200, role: "owner", clerkUserId: "owner1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      { clerkUserId: "owner1", role: "owner", createdAt: new Date(), updatedAt: new Date() },
      { clerkUserId: "u1", role: "member", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });

    expect(res.status).toBe(200);
    expect(cohortStore.listAdminMembershipsForUser).not.toHaveBeenCalled();
    expect(cohortStore.demoteAdminMemberships).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test -w web -- users-role`
Expected: FAIL — the 409 case returns 200, and the cascade is never called.

- [ ] **Step 3: Implement the check**

In `packages/web/src/app/admin/api/users/[clerkUserId]/role/route.ts`, after the existing last-owner
guard and before the `upsertRole` call:

```ts
  // Only a demotion to `member` can break the invariant: an owner or admin is
  // still allowed to hold a group admin role.
  if (role === "member") {
    const adminMemberships = await cohortStore.listAdminMembershipsForUser(clerkUserId);
    const stranded = adminMemberships.filter((m) => m.adminCount <= 1);
    if (stranded.length > 0) {
      const names = stranded.map((m) => m.cohortName).join(", ");
      return NextResponse.json(
        {
          error: `This user is the only admin of ${names}. Give those groups another admin first.`,
        },
        { status: 409 },
      );
    }

    await userRoleStore.upsertRole(clerkUserId, role);
    // Not one transaction — two stores, two pools' worth of state. Platform
    // first, cascade second: if the cascade fails, a retry of the same request
    // finishes the job, whereas the reverse order would strip group admins from
    // someone whose platform role never actually changed.
    await cohortStore.demoteAdminMemberships(clerkUserId);
    return NextResponse.json({ ok: true });
  }
```

Add `cohortStore` to the existing `import { userRoleStore } from "@/lib/db";`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm run test -w web -- users-role && npm run lint -w web`
Expected: PASS — the three new cases plus the six shipped ones.

- [ ] **Step 5: Verify manually**

Create a group as a platform Admin (so they are its only admin). As the Super Admin, demote them to
Member on `/admin` and confirm the error names the group and the role does not change. Add a second
group admin, retry the demotion, and confirm it succeeds and that the group page now shows the
demoted user as a plain member.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/admin/api/users packages/web/tests/integration/admin-api/users-role.test.ts
git commit -m "Web: hold the platform-admin invariant when demoting a group admin"
```

---

## Definition of Done

The milestone is complete when all of the following pass from a clean checkout:

```bash
docker compose up -d
npm install
npm run build -w core
npm run migrate -w core
npm run seed -w web
npm run test -w core        # core unit + real-Postgres store tests
npm run test -w web         # route handler + lib tests, no database
npm run lint -w web
npm run build -w web
```

Plus the manual pass described in Tasks 12–16: create a group, invite an existing user and an unknown
email, promote and demote a group admin, create a session with two emoji and a participant subset,
close and reopen it, disable a catalog entry and see it leave the picker without breaking a session
that uses it.

---

## Tracking: milestone, issues, and board

Run **after** this plan is committed — each issue body quotes its task's acceptance criteria from
here, so the plan has to exist first.

- [ ] **Step 1: Confirm the board before touching it**

```bash
gh project list --owner pete-the-pete
```

Expect Project **#6 ("Mangoes")**. **Never run `gh project create`** — two prior sessions created
stray boards (#7, #8) that had to be deleted.

- [ ] **Step 2: Create the milestone**

```bash
gh api repos/pete-the-pete/mangoes/milestones \
  -f title="v0.2 — Groups & Sessions" \
  -f description="Admin-side groups, time-boxed sessions, and the emoji catalog. Spec: docs/specs/2026-08-24-groups-and-sessions-design.md, plan: docs/plans/2026-08-24-groups-and-sessions.md"
```

- [ ] **Step 3: Create the sixteen issues in dependency order**

One per task, titled `Task N: <task heading>`. Each body carries: a one-line summary, links to the
spec and this plan (with the task's anchor), the acceptance criteria taken from that task's
verification steps, and a `Blocked by` line left as a placeholder for Step 4:

```bash
gh issue create \
  --milestone "v0.2 — Groups & Sessions" \
  --title "Task 1: Core — cohorts schema, types, and store" \
  --body "$(cat <<'BODY'
Adds the `cohorts` and `cohort_members` tables plus the Postgres-backed `CohortStore`.

Spec: docs/specs/2026-08-24-groups-and-sessions-design.md
Plan: docs/plans/2026-08-24-groups-and-sessions.md (Task 1)

**Acceptance criteria**
- `createCohort` inserts the cohort and the creator's `admin` membership in one transaction.
- `listCohortsForUser` returns only cohorts the user belongs to.
- `listAdminMembershipsForUser` reports each cohort's admin count.
- `npm run test -w core -- cohortStore` passes against local Docker Postgres.

Blocked by: none
BODY
)"
```

Dependencies: 2←1; 3←1,4; 5←4; 6←1,3,4; 7←6; 8←2,6; 9←1; 10←3,6; 11←4; 12←7; 13←8,10,12;
14←10,11,13; 15←11,12; 16←1,2. Tasks 1 and 4 have none and can run in parallel.

- [ ] **Step 4: Fill in the real issue numbers**

Issue numbers do not exist until creation, so this is a second pass:

```bash
gh issue list --milestone "v0.2 — Groups & Sessions" --limit 20 \
  --json number,title --jq '.[] | "\(.number)\t\(.title)"'
```

Then `gh issue edit <n> --body ...` to replace each `Blocked by: none` placeholder with the real
`Blocked by #N` references. Plain text in the body is the convention this repo settled on — GitHub
Issues have no queryable dependency field (see `docs/plans/2026-08-22-milestone-execution-workflow.md`).

- [ ] **Step 5: Add every issue to Project #6**

```bash
gh project item-add 6 --owner pete-the-pete --url <issue-url>
```

- [ ] **Step 6: Set Status**

Read the field ids once, then set each item:

```bash
gh project field-list 6 --owner pete-the-pete
```

Tasks 1 and 4 → **Ready** (nothing blocks them). Everything else → **Backlog**. Use
`gh project item-edit --id <item-id> --field-id <status-field-id> --single-select-option-id <option-id>`.

- [ ] **Step 7: Commit nothing**

This step touches GitHub only — there is no repo change to commit. Confirm the board reads correctly
at https://github.com/users/pete-the-pete/projects/6 before starting Task 1.
