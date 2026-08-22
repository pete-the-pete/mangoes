# Super Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Clerk-backed Google login plus an `/admin` UI where a Super Admin can list all
platform users, invite new users (gmail-only), and change any user's role.

**Architecture:** `packages/core` gains a framework-agnostic `roles` module (types, a
Postgres-backed store, a pure last-owner guard, and a role-resolution function) with zero Clerk
or Next.js imports. `packages/web` wires Clerk (auth), calls into `core` for role state, and
exposes the `/admin` UI plus three route handlers (list, invite, change-role).

**Tech Stack:** Next.js App Router (`packages/web`), plain TypeScript (`packages/core`), Postgres
via `pg`, Clerk (`@clerk/nextjs`) for auth/invites, Vitest for tests, Docker Compose for local Postgres.

## Global Constraints

- TypeScript strict mode everywhere, no implicit `any` (root `CLAUDE.md`).
- `packages/core` may never import from `packages/web`, Next.js, or Clerk, and may never contain
  app-specific nouns ("mango," "group," "trip," "day," "wager") — root `CLAUDE.md`.
- npm workspaces (not Turborepo/pnpm) — root `CLAUDE.md`.
- Node.js >= 26.7.0 (`package.json` engines field).
- Postgres is the database (root `CLAUDE.md`); Docker + Docker Compose for local dev (root `CLAUDE.md`).
- Role values are `"owner" | "admin" | "member"` at the core layer; `packages/web` maps these to the
  display labels "Super Admin" / "Admin" / "Member" (spec: Architecture).
- Invite email must match `@gmail.com` (case-insensitive) before any Clerk API call is made (spec: API Surface).
- A role change must never leave zero `owner` users (spec: Must Have, API Surface).
- No E2E/browser tests in this slice (spec: Testing) — UI tasks are manually verified via the dev server.

---

## Prerequisite / External Tickets

These block downstream code tasks and require action outside this repo (a dashboard, a hosted
service, or an account you control) — file each as its own GitHub issue with explicit "blocks"
links to the tasks listed, rather than folding them into a code task.

### Ticket E1: Create Clerk application with Google OAuth

**Not agent-executable — requires the Clerk dashboard.**

- Create a Clerk application (or use an existing one).
- Enable Google as a social connection; disable email/password and any other sign-in method so
  Google is the only path (matches spec: "Google OAuth only").
- Enable "Restricted" sign-up mode (invite-only) in Clerk's dashboard so unsolicited sign-ups are
  rejected at the auth layer, not just hidden in the UI.
- Copy the publishable key and secret key somewhere you can paste into `.env` locally.

**Blocks:** Task 5 (Clerk SDK install/config — needs real keys to run the dev server end-to-end),
and by extension every later web task that depends on Task 5's middleware/provider being live.
Tasks 1–4 (core logic) and the test-writing parts of Tasks 6–9 do not need this (they mock Clerk).

### Ticket E2: Provision hosted Postgres for Vercel

**Not agent-executable — requires a hosted database account/provisioning decision.**

- Provision a Postgres instance reachable from Vercel (e.g. Vercel Postgres, Neon, Supabase — any
  is fine for this slice; the schema is a single table).
- Note the connection string for use in Ticket E3.

**Blocks:** Production deploy/verification only. Local development is unblocked by Task 1's Docker
Compose Postgres and does not depend on this ticket.

### Ticket E3: Set Vercel environment variables

**Not agent-executable — requires Vercel project settings access.**

- Set `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (from Ticket E1), `DATABASE_URL`
  (from Ticket E2), and `ULTRA_ADMIN_EMAIL` (a single gmail address — yours) in
  the Vercel project's environment variables.

**Depends on:** Ticket E1, Ticket E2.
**Blocks:** Any production deploy of this feature. Does not block local development (`.env` covers
that) or any of Tasks 1–10.

---

## Task 1: Local Postgres via Docker Compose + schema

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `packages/core/src/db/schema.sql`
- Create: `packages/core/src/db/migrate.ts`
- Create: `packages/core/scripts/migrate.ts`
- Modify: `packages/core/package.json`

**Interfaces:**
- Produces: `runMigrations(pool: Pool): Promise<void>` — later tasks' tests rely on the
  `user_roles` table existing in the local test database before they run.

- [x] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: mango
      POSTGRES_PASSWORD: mango
      POSTGRES_DB: mango_tracker
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mango -d mango_tracker"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
```

- [x] **Step 2: Start it and verify it's healthy**

Run: `docker compose up -d && docker compose ps`
Expected: `postgres` service shows `healthy` within ~10s.

- [x] **Step 3: Write `.env.example`**

```
DATABASE_URL=postgresql://mango:mango@localhost:5432/mango_tracker
```

Local-only values only. `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
and `ULTRA_ADMIN_EMAIL` are Development-scoped in Vercel and arrive via
`vercel env pull` — duplicating them here as blanks risks the empty copy
shadowing the real one.

- [x] **Step 4: Copy it to a real `.env` for local dev**

Run: `cp .env.example .env`
Expected: `.env` exists (already gitignored — confirmed in `.gitignore`'s `.env*.local` / `.env` entries).

- [x] **Step 5: Write the schema**

```sql
-- packages/core/src/db/schema.sql
CREATE TABLE IF NOT EXISTS user_roles (
  clerk_user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [x] **Step 6: Write the migration runner**

```ts
// packages/core/src/db/migrate.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Pool } from "pg";

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema.sql",
);

export async function runMigrations(pool: Pool): Promise<void> {
  const schema = readFileSync(schemaPath, "utf8");
  await pool.query(schema);
}
```

- [x] **Step 7: Write the manual migration script**

```ts
// packages/core/scripts/migrate.ts
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate.js";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({ connectionString });
  try {
    await runMigrations(pool);
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 8: Add dependencies and a migrate script to `packages/core/package.json`**

Add to `dependencies`: `"pg": "^8.13.0"`
Add to `devDependencies`: `"@types/pg": "^8.11.0"`, `"tsx": "^4.19.0"`
Add to `scripts`: `"migrate": "tsx scripts/migrate.ts"`

- [x] **Step 9: Install and run the migration against local Postgres**

Run: `npm install && set -a && source .env && set +a && npm run migrate -w core`
Expected: prints `Migrations applied.`

- [x] **Step 10: Verify the table exists**

Run: `docker compose exec postgres psql -U mango -d mango_tracker -c '\d user_roles'`
Expected: shows the `user_roles` table with columns `clerk_user_id`, `role`, `created_at`, `updated_at`.

- [x] **Step 11: Commit**

```bash
git add docker-compose.yml .env.example packages/core/src/db packages/core/scripts packages/core/package.json package-lock.json
git commit -m "infra: add local Postgres via Docker Compose and user_roles schema"
```

---

## Task 2: Core — Role types + last-owner guard

**Files:**
- Create: `packages/core/src/roles/types.ts`
- Create: `packages/core/src/roles/lastOwnerGuard.ts`
- Test: `packages/core/src/roles/lastOwnerGuard.test.ts`
- Modify: `packages/core/package.json`
- Create: `packages/core/vitest.config.ts`

**Interfaces:**
- Produces: `type Role = "owner" | "admin" | "member"`; `interface UserRoleRecord { clerkUserId: string; role: Role; createdAt: Date; updatedAt: Date }`; `wouldRemoveLastOwner(currentRoles: Pick<UserRoleRecord, "clerkUserId" | "role">[], targetUserId: string, newRole: Role): boolean`. Later tasks (3, 4, and web Tasks 6–9) import all three from `core`.

- [ ] **Step 1: Add Vitest to `packages/core`**

Add to `devDependencies`: `"vitest": "^2.1.0"`
Add to `scripts`: `"test": "vitest run"`

```ts
// packages/core/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 2: Write the `Role` and `UserRoleRecord` types**

```ts
// packages/core/src/roles/types.ts
export type Role = "owner" | "admin" | "member";

export interface UserRoleRecord {
  clerkUserId: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 3: Write the failing test for the last-owner guard**

```ts
// packages/core/src/roles/lastOwnerGuard.test.ts
import { describe, it, expect } from "vitest";
import { wouldRemoveLastOwner } from "./lastOwnerGuard.js";

describe("wouldRemoveLastOwner", () => {
  it("returns true when demoting the sole owner", () => {
    const roles = [{ clerkUserId: "u1", role: "owner" as const }];
    expect(wouldRemoveLastOwner(roles, "u1", "admin")).toBe(true);
  });

  it("returns false when another owner remains", () => {
    const roles = [
      { clerkUserId: "u1", role: "owner" as const },
      { clerkUserId: "u2", role: "owner" as const },
    ];
    expect(wouldRemoveLastOwner(roles, "u1", "admin")).toBe(false);
  });

  it("returns false when the target is not currently an owner", () => {
    const roles = [{ clerkUserId: "u1", role: "admin" as const }];
    expect(wouldRemoveLastOwner(roles, "u1", "member")).toBe(false);
  });

  it("returns false when the new role is still owner", () => {
    const roles = [{ clerkUserId: "u1", role: "owner" as const }];
    expect(wouldRemoveLastOwner(roles, "u1", "owner")).toBe(false);
  });

  it("returns false when the target user is not found", () => {
    const roles = [{ clerkUserId: "u1", role: "owner" as const }];
    expect(wouldRemoveLastOwner(roles, "u2", "admin")).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test -w core`
Expected: FAIL — `lastOwnerGuard.ts` does not exist.

- [ ] **Step 5: Implement the guard**

```ts
// packages/core/src/roles/lastOwnerGuard.ts
import type { Role, UserRoleRecord } from "./types.js";

export function wouldRemoveLastOwner(
  currentRoles: Pick<UserRoleRecord, "clerkUserId" | "role">[],
  targetUserId: string,
  newRole: Role,
): boolean {
  const target = currentRoles.find((r) => r.clerkUserId === targetUserId);
  if (!target || target.role !== "owner" || newRole === "owner") {
    return false;
  }
  const ownerCount = currentRoles.filter((r) => r.role === "owner").length;
  return ownerCount <= 1;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm run test -w core`
Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/roles/types.ts packages/core/src/roles/lastOwnerGuard.ts packages/core/src/roles/lastOwnerGuard.test.ts packages/core/vitest.config.ts packages/core/package.json package-lock.json
git commit -m "feat(core): add Role types and last-owner guard"
```

---

## Task 3: Core — Postgres-backed user role store

**Files:**
- Create: `packages/core/src/roles/userRoleStore.ts`
- Test: `packages/core/src/roles/userRoleStore.test.ts`

**Interfaces:**
- Consumes: `UserRoleRecord`, `Role` from Task 2's `./types.js`; requires the `user_roles` table
  from Task 1 to exist in the database the tests connect to.
- Produces: `interface UserRoleStore { getRole(clerkUserId: string): Promise<Role | undefined>; upsertRole(clerkUserId: string, role: Role): Promise<void>; listRoles(): Promise<UserRoleRecord[]> }`; `createPostgresUserRoleStore(pool: Pool): UserRoleStore`. Task 4 and all web tasks (6–9) depend on this interface shape.

- [ ] **Step 1: Write the failing test (against real local Postgres)**

```ts
// packages/core/src/roles/userRoleStore.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { createPostgresUserRoleStore } from "./userRoleStore.js";
import { runMigrations } from "../db/migrate.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

beforeEach(async () => {
  await runMigrations(pool);
  await pool.query("DELETE FROM user_roles");
});

afterAll(async () => {
  await pool.end();
});

describe("createPostgresUserRoleStore", () => {
  it("returns undefined for a user with no role row", async () => {
    const store = createPostgresUserRoleStore(pool);
    expect(await store.getRole("nobody")).toBeUndefined();
  });

  it("upserts and then returns the role", async () => {
    const store = createPostgresUserRoleStore(pool);
    await store.upsertRole("u1", "owner");
    expect(await store.getRole("u1")).toBe("owner");
  });

  it("upsert overwrites an existing role", async () => {
    const store = createPostgresUserRoleStore(pool);
    await store.upsertRole("u1", "member");
    await store.upsertRole("u1", "admin");
    expect(await store.getRole("u1")).toBe("admin");
  });

  it("lists all role records", async () => {
    const store = createPostgresUserRoleStore(pool);
    await store.upsertRole("u1", "owner");
    await store.upsertRole("u2", "member");
    const rows = await store.listRoles();
    expect(rows.map((r) => [r.clerkUserId, r.role]).sort()).toEqual([
      ["u1", "owner"],
      ["u2", "member"],
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npm run test -w core`
Expected: FAIL — `userRoleStore.ts` does not exist.

- [ ] **Step 3: Implement the store**

```ts
// packages/core/src/roles/userRoleStore.ts
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
      const result = await pool.query<UserRoleRow>(
        "SELECT * FROM user_roles WHERE clerk_user_id = $1",
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

    async listRoles() {
      const result = await pool.query<UserRoleRow>("SELECT * FROM user_roles");
      return result.rows.map(toRecord);
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `set -a && source .env && set +a && npm run test -w core`
Expected: PASS — 4 new tests (9 total).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/roles/userRoleStore.ts packages/core/src/roles/userRoleStore.test.ts
git commit -m "feat(core): add Postgres-backed user role store"
```

---

## Task 4: Core — role-resolution function

**Files:**
- Create: `packages/core/src/roles/resolveRole.ts`
- Test: `packages/core/src/roles/resolveRole.test.ts`
- Modify: `packages/core/src/roles/index.ts` (create if absent)
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `UserRoleStore`, `Role` from Task 3.
- Produces: `interface ResolveRoleInput { clerkUserId: string; email: string; bootstrapEmails: string[]; intendedRoleFromInvitation?: Role }`; `resolveRole(store: UserRoleStore, input: ResolveRoleInput): Promise<Role>`. Web Task 6's `getCurrentUserRole` depends on this exact signature.

- [ ] **Step 1: Write the failing test with an in-memory fake store**

```ts
// packages/core/src/roles/resolveRole.test.ts
import { describe, it, expect } from "vitest";
import { resolveRole } from "./resolveRole.js";
import type { UserRoleStore } from "./userRoleStore.js";
import type { Role } from "./types.js";

function fakeStore(initial: Record<string, Role> = {}): UserRoleStore {
  const roles = new Map(Object.entries(initial));
  return {
    async getRole(id) {
      return roles.get(id);
    },
    async upsertRole(id, role) {
      roles.set(id, role);
    },
    async listRoles() {
      return [...roles.entries()].map(([clerkUserId, role]) => ({
        clerkUserId,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  };
}

describe("resolveRole", () => {
  it("returns the existing role without touching the store further", async () => {
    const store = fakeStore({ u1: "admin" });
    const role = await resolveRole(store, {
      clerkUserId: "u1",
      email: "u1@gmail.com",
      bootstrapEmails: [],
    });
    expect(role).toBe("admin");
  });

  it("bootstraps a matching email as owner when no row exists", async () => {
    const store = fakeStore();
    const role = await resolveRole(store, {
      clerkUserId: "u1",
      email: "Pete@Gmail.com",
      bootstrapEmails: ["pete@gmail.com"],
    });
    expect(role).toBe("owner");
    expect(await store.getRole("u1")).toBe("owner");
  });

  it("uses the invitation's intended role when no row exists and email isn't a bootstrap match", async () => {
    const store = fakeStore();
    const role = await resolveRole(store, {
      clerkUserId: "u2",
      email: "friend@gmail.com",
      bootstrapEmails: ["pete@gmail.com"],
      intendedRoleFromInvitation: "admin",
    });
    expect(role).toBe("admin");
    expect(await store.getRole("u2")).toBe("admin");
  });

  it("falls back to member when no row, no bootstrap match, and no invitation role", async () => {
    const store = fakeStore();
    const role = await resolveRole(store, {
      clerkUserId: "u3",
      email: "stranger@gmail.com",
      bootstrapEmails: ["pete@gmail.com"],
    });
    expect(role).toBe("member");
    expect(await store.getRole("u3")).toBe("member");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w core`
Expected: FAIL — `resolveRole.ts` does not exist.

- [ ] **Step 3: Implement `resolveRole`**

```ts
// packages/core/src/roles/resolveRole.ts
import type { UserRoleStore } from "./userRoleStore.js";
import type { Role } from "./types.js";

export interface ResolveRoleInput {
  clerkUserId: string;
  email: string;
  bootstrapEmails: string[];
  intendedRoleFromInvitation?: Role;
}

export async function resolveRole(
  store: UserRoleStore,
  input: ResolveRoleInput,
): Promise<Role> {
  const existing = await store.getRole(input.clerkUserId);
  if (existing) {
    return existing;
  }

  const normalizedEmail = input.email.toLowerCase();
  const isBootstrap = input.bootstrapEmails
    .map((email) => email.toLowerCase())
    .includes(normalizedEmail);

  const role: Role = isBootstrap
    ? "owner"
    : (input.intendedRoleFromInvitation ?? "member");

  await store.upsertRole(input.clerkUserId, role);
  return role;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w core`
Expected: PASS — 4 new tests (13 total).

- [ ] **Step 5: Add the barrel export**

```ts
// packages/core/src/roles/index.ts
export * from "./types.js";
export * from "./lastOwnerGuard.js";
export * from "./userRoleStore.js";
export * from "./resolveRole.js";
```

```ts
// packages/core/src/index.ts
export * from "./roles/index.js";
```

- [ ] **Step 6: Build core to confirm the exports compile**

Run: `npm run build -w core`
Expected: succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/roles/resolveRole.ts packages/core/src/roles/resolveRole.test.ts packages/core/src/roles/index.ts packages/core/src/index.ts
git commit -m "feat(core): add role-resolution function and public exports"
```

---

## Task 5: Web — Clerk install, provider, middleware, sign-in page

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/src/middleware.ts`
- Modify: `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/app/sign-in/[[...sign-in]]/page.tsx`

**Interfaces:**
- Produces: authenticated session context available to `auth()`/`clerkClient()` calls in Task 6+.

This task has no automated tests — Clerk's middleware and provider require a live Clerk app to
exercise meaningfully, and Ticket E1 is the blocker for that. Every step here is code that compiles
without real keys; the verification steps at the end require Ticket E1 to be complete.

- [ ] **Step 1: Add the Clerk dependency**

Add to `packages/web/package.json` `dependencies`: `"@clerk/nextjs": "^6.14.0"`

Run: `npm install`

- [ ] **Step 2: Write the middleware**

```ts
// packages/web/src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
```

- [ ] **Step 3: Wrap the root layout in `ClerkProvider`**

```tsx
// packages/web/src/app/layout.tsx
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mango Tracker",
  description: "Coming soon",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 4: Add the sign-in page**

```tsx
// packages/web/src/app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <SignIn />
    </div>
  );
}
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build -w web`
Expected: succeeds (Clerk components compile even without valid keys set; only runtime calls need real keys).

- [ ] **Step 6: Manual verification (requires Ticket E1 complete and real keys in `.env`)**

Run: `npm run dev -w web`, visit `http://localhost:3000/admin`
Expected: redirected to `/sign-in`, Google sign-in button visible, no other sign-in methods shown.

- [ ] **Step 7: Commit**

```bash
git add packages/web/package.json package-lock.json packages/web/src/middleware.ts packages/web/src/app/layout.tsx packages/web/src/app/sign-in
git commit -m "feat(web): add Clerk auth, middleware, and sign-in page"
```

---

## Task 6: Web — auth helpers + admin role gate

**Files:**
- Create: `packages/web/src/lib/db.ts`
- Create: `packages/web/src/lib/auth.ts`
- Test: `packages/web/src/lib/auth.test.ts`
- Create: `packages/web/src/app/admin/layout.tsx`
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`

**Interfaces:**
- Consumes: `createPostgresUserRoleStore`, `resolveRole`, `Role`, `UserRoleStore` from `core` (Tasks 2–4).
- Produces: `getCurrentUserRole(store?: UserRoleStore): Promise<{ clerkUserId: string; role: Role } | null>`; `requireRole(allowed: Role[], store?: UserRoleStore): Promise<{ ok: boolean; status: number; error?: string; role?: Role; clerkUserId?: string }>`. Tasks 7–9's route handlers depend on `requireRole`'s exact return shape.

- [ ] **Step 1: Add test tooling to `packages/web`**

Add to `devDependencies`: `"vitest": "^2.1.0"`, `"vite-tsconfig-paths": "^5.1.0"`
Add to `scripts`: `"test": "vitest run"`

```ts
// packages/web/vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 2: Add `pg` and wire the Postgres-backed store singleton**

Add to `dependencies`: `"pg": "^8.13.0"`, `"core": "0.0.0"`
Add to `devDependencies`: `"@types/pg": "^8.11.0"`

```ts
// packages/web/src/lib/db.ts
import { Pool } from "pg";
import { createPostgresUserRoleStore } from "core";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const userRoleStore = createPostgresUserRoleStore(pool);
```

- [ ] **Step 3: Write the failing test for `requireRole`**

```ts
// packages/web/src/lib/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRoleStore } from "core";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  clerkClient: vi.fn(),
}));

import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "./auth.js";

function fakeStore(
  initial: Record<string, "owner" | "admin" | "member"> = {},
): UserRoleStore {
  const roles = new Map(Object.entries(initial));
  return {
    async getRole(id) {
      return roles.get(id);
    },
    async upsertRole(id, role) {
      roles.set(id, role);
    },
    async listRoles() {
      return [...roles.entries()].map(([clerkUserId, role]) => ({
        clerkUserId,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  };
}

describe("requireRole", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(clerkClient).mockReset();
  });

  it("returns 401 when not signed in", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await requireRole(["owner"], fakeStore());
    expect(result).toEqual({ ok: false, status: 401, error: "Not signed in" });
  });

  it("returns 403 when the resolved role isn't allowed", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          primaryEmailAddress: { emailAddress: "friend@gmail.com" },
          publicMetadata: {},
        }),
      },
    } as never);
    const result = await requireRole(["owner"], fakeStore({ u1: "member" }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("returns ok: true when the resolved role is allowed", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUser: vi.fn().mockResolvedValue({
          primaryEmailAddress: { emailAddress: "pete@gmail.com" },
          publicMetadata: {},
        }),
      },
    } as never);
    const result = await requireRole(
      ["owner", "admin"],
      fakeStore({ u1: "owner" }),
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — `auth.ts` does not exist.

- [ ] **Step 5: Implement `packages/web/src/lib/auth.ts`**

```ts
// packages/web/src/lib/auth.ts
import { auth, clerkClient } from "@clerk/nextjs/server";
import { resolveRole, type Role, type UserRoleStore } from "core";
import { userRoleStore } from "./db.js";

// One bootstrap admin, not a list. `core`'s resolveRole keeps a general
// `bootstrapEmails: string[]` interface; the app is what decides there is
// exactly one, so core stays domain-agnostic.
const ULTRA_ADMIN_EMAIL = process.env.ULTRA_ADMIN_EMAIL?.trim() ?? "";
const BOOTSTRAP_EMAILS = ULTRA_ADMIN_EMAIL ? [ULTRA_ADMIN_EMAIL] : [];

export async function getCurrentUserRole(
  store: UserRoleStore = userRoleStore,
): Promise<{ clerkUserId: string; role: Role } | null> {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const intendedRoleFromInvitation = user.publicMetadata?.intendedRole as
    | Role
    | undefined;

  const role = await resolveRole(store, {
    clerkUserId: userId,
    email,
    bootstrapEmails: BOOTSTRAP_EMAILS,
    intendedRoleFromInvitation,
  });

  return { clerkUserId: userId, role };
}

export interface RoleGuardResult {
  ok: boolean;
  status: number;
  error?: string;
  role?: Role;
  clerkUserId?: string;
}

export async function requireRole(
  allowed: Role[],
  store: UserRoleStore = userRoleStore,
): Promise<RoleGuardResult> {
  const current = await getCurrentUserRole(store);
  if (!current) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  if (!allowed.includes(current.role)) {
    return {
      ok: false,
      status: 403,
      error: "Not authorized",
      role: current.role,
      clerkUserId: current.clerkUserId,
    };
  }
  return {
    ok: true,
    status: 200,
    role: current.role,
    clerkUserId: current.clerkUserId,
  };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npm run test -w web`
Expected: PASS — 3 tests.

- [ ] **Step 7: Write the admin role gate**

```tsx
// packages/web/src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const current = await getCurrentUserRole();
  if (!current) {
    redirect("/sign-in");
  }
  if (current.role !== "owner" && current.role !== "admin") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-xl font-semibold">Not authorized</h1>
        <p className="text-sm text-gray-500">
          Your account does not have access to the admin area.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 8: Manual verification (requires Task 5's Ticket E1 keys and a `member`-role test account)**

Sign in as a non-admin gmail account, visit `/admin`.
Expected: sees the "Not authorized" message, not the user table.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib packages/web/src/app/admin/layout.tsx packages/web/package.json package-lock.json packages/web/vitest.config.ts
git commit -m "feat(web): add role-resolution auth helpers and admin route gate"
```

---

## Task 7: Web — `GET /admin/api/users` (list users)

**Files:**
- Create: `packages/web/src/lib/adminUsers.ts`
- Test: `packages/web/src/lib/adminUsers.test.ts`
- Create: `packages/web/src/app/admin/api/users/route.ts`
- Test: `packages/web/src/app/admin/api/users/route.test.ts`

**Interfaces:**
- Consumes: `requireRole` from Task 6; `UserRoleStore` from `core`.
- Produces: `interface AdminUserRow { id: string; email: string | null; name: string | null; avatarUrl: string; createdAt: string; role: "owner" | "admin" | "member" | null }`; `listUsersForAdmin(store?: UserRoleStore): Promise<AdminUserRow[]>`. Tasks 10 (UI) and this task's route handler both depend on `AdminUserRow`'s exact shape.

- [ ] **Step 1: Write the failing test for `listUsersForAdmin`**

```ts
// packages/web/src/lib/adminUsers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRoleStore } from "core";

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { clerkClient } from "@clerk/nextjs/server";
import { listUsersForAdmin } from "./adminUsers.js";

function fakeStore(
  rows: { clerkUserId: string; role: "owner" | "admin" | "member" }[],
): UserRoleStore {
  return {
    async getRole(id) {
      return rows.find((r) => r.clerkUserId === id)?.role;
    },
    async upsertRole() {},
    async listRoles() {
      return rows.map((r) => ({
        ...r,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  };
}

describe("listUsersForAdmin", () => {
  beforeEach(() => vi.mocked(clerkClient).mockReset());

  it("merges Clerk identity with the stored role", async () => {
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUserList: vi.fn().mockResolvedValue({
          data: [
            {
              id: "u1",
              firstName: "Pete",
              lastName: "L",
              imageUrl: "https://example.com/a.png",
              createdAt: 1700000000000,
              primaryEmailAddress: { emailAddress: "pete@gmail.com" },
            },
          ],
        }),
      },
    } as never);

    const result = await listUsersForAdmin(
      fakeStore([{ clerkUserId: "u1", role: "owner" }]),
    );

    expect(result).toEqual([
      {
        id: "u1",
        email: "pete@gmail.com",
        name: "Pete L",
        avatarUrl: "https://example.com/a.png",
        createdAt: new Date(1700000000000).toISOString(),
        role: "owner",
      },
    ]);
  });

  it("returns role: null for a Clerk user with no stored role row", async () => {
    vi.mocked(clerkClient).mockResolvedValue({
      users: {
        getUserList: vi.fn().mockResolvedValue({
          data: [
            {
              id: "u2",
              firstName: null,
              lastName: null,
              imageUrl: "https://example.com/b.png",
              createdAt: 1700000000000,
              primaryEmailAddress: { emailAddress: "friend@gmail.com" },
            },
          ],
        }),
      },
    } as never);

    const result = await listUsersForAdmin(fakeStore([]));
    expect(result[0]!.role).toBeNull();
    expect(result[0]!.name).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — `adminUsers.ts` does not exist.

- [ ] **Step 3: Implement `listUsersForAdmin`**

```ts
// packages/web/src/lib/adminUsers.ts
import { clerkClient } from "@clerk/nextjs/server";
import type { UserRoleStore } from "core";
import { userRoleStore } from "./db.js";

export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string;
  createdAt: string;
  role: "owner" | "admin" | "member" | null;
}

export async function listUsersForAdmin(
  store: UserRoleStore = userRoleStore,
): Promise<AdminUserRow[]> {
  const clerk = await clerkClient();
  const { data: clerkUsers } = await clerk.users.getUserList({ limit: 100 });
  const roles = await store.listRoles();
  const roleByUserId = new Map(roles.map((r) => [r.clerkUserId, r.role]));

  return clerkUsers.map((u) => ({
    id: u.id,
    email: u.primaryEmailAddress?.emailAddress ?? null,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
    avatarUrl: u.imageUrl,
    createdAt: new Date(u.createdAt).toISOString(),
    role: roleByUserId.get(u.id) ?? null,
  }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w web`
Expected: PASS — 2 new tests.

- [ ] **Step 5: Write the failing test for the route handler**

```ts
// packages/web/src/app/admin/api/users/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/adminUsers", () => ({ listUsersForAdmin: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/adminUsers";
import { GET } from "./route.js";

describe("GET /admin/api/users", () => {
  it("returns the guard's status when not authorized", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns the merged user list when authorized", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(listUsersForAdmin).mockResolvedValue([
      {
        id: "u1",
        email: "pete@gmail.com",
        name: "Pete",
        avatarUrl: "x",
        createdAt: "now",
        role: "owner",
      },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 7: Implement the route handler**

```ts
// packages/web/src/app/admin/api/users/route.ts
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/adminUsers";

export async function GET() {
  const guard = await requireRole(["owner", "admin"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const users = await listUsersForAdmin();
  return NextResponse.json({ users });
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm run test -w web`
Expected: PASS — 2 new tests.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/adminUsers.ts packages/web/src/lib/adminUsers.test.ts packages/web/src/app/admin/api/users
git commit -m "feat(web): add GET /admin/api/users route"
```

---

## Task 8: Web — `POST /admin/api/users/invite` (invite user)

**Files:**
- Create: `packages/web/src/app/admin/api/users/invite/route.ts`
- Test: `packages/web/src/app/admin/api/users/invite/route.test.ts`

**Interfaces:**
- Consumes: `requireRole` from Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/app/admin/api/users/invite/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { requireRole } from "@/lib/auth";
import { clerkClient } from "@clerk/nextjs/server";
import { POST } from "./route.js";

function makeRequest(body: unknown) {
  return new Request("http://localhost/admin/api/users/invite", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /admin/api/users/invite", () => {
  it("returns the guard's status when not owner", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await POST(makeRequest({ email: "a@gmail.com", role: "admin" }));
    expect(res.status).toBe(403);
  });

  it("rejects a non-gmail address without calling Clerk", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const createInvitation = vi.fn();
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: { createInvitation },
    } as never);

    const res = await POST(
      makeRequest({ email: "a@yahoo.com", role: "admin" }),
    );
    expect(res.status).toBe(400);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const res = await POST(
      makeRequest({ email: "a@gmail.com", role: "owner" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a Clerk invitation with the intended role in metadata", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    const createInvitation = vi.fn().mockResolvedValue({});
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: { createInvitation },
    } as never);

    const res = await POST(
      makeRequest({ email: "friend@gmail.com", role: "member" }),
    );
    expect(res.status).toBe(201);
    expect(createInvitation).toHaveBeenCalledWith({
      emailAddress: "friend@gmail.com",
      publicMetadata: { intendedRole: "member" },
    });
  });

  it("returns 502 when Clerk's invitation call throws", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(clerkClient).mockResolvedValue({
      invitations: {
        createInvitation: vi.fn().mockRejectedValue(new Error("duplicate")),
      },
    } as never);

    const res = await POST(
      makeRequest({ email: "friend@gmail.com", role: "member" }),
    );
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 3: Implement the route handler**

```ts
// packages/web/src/app/admin/api/users/invite/route.ts
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth";

const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

export async function POST(request: Request) {
  const guard = await requireRole(["owner"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await request.json();
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role;

  if (!GMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { error: "Email must be a @gmail.com address" },
      { status: 400 },
    );
  }
  if (role !== "admin" && role !== "member") {
    return NextResponse.json(
      { error: "Role must be admin or member" },
      { status: 400 },
    );
  }

  const clerk = await clerkClient();
  try {
    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { intendedRole: role },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create invitation";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w web`
Expected: PASS — 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/admin/api/users/invite
git commit -m "feat(web): add POST /admin/api/users/invite route"
```

---

## Task 9: Web — `PATCH /admin/api/users/:clerkUserId/role` (change role)

**Files:**
- Create: `packages/web/src/app/admin/api/users/[clerkUserId]/role/route.ts`
- Test: `packages/web/src/app/admin/api/users/[clerkUserId]/role/route.test.ts`

**Interfaces:**
- Consumes: `requireRole` from Task 6; `userRoleStore` from `packages/web/src/lib/db.ts`; `wouldRemoveLastOwner` from `core` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/app/admin/api/users/[clerkUserId]/role/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  userRoleStore: {
    listRoles: vi.fn(),
    upsertRole: vi.fn(),
    getRole: vi.fn(),
  },
}));

import { requireRole } from "@/lib/auth";
import { userRoleStore } from "@/lib/db";
import { PATCH } from "./route.js";

function makeRequest(body: unknown) {
  return new Request("http://localhost/admin/api/users/u1/role", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /admin/api/users/:clerkUserId/role", () => {
  it("returns the guard's status when not owner", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Not authorized",
    });
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an invalid role", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "owner1",
    });
    const res = await PATCH(makeRequest({ role: "nonsense" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(400);
  });

  it("blocks demoting the last remaining owner", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      {
        clerkUserId: "u1",
        role: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u1" }),
    });
    expect(res.status).toBe(409);
    expect(userRoleStore.upsertRole).not.toHaveBeenCalled();
  });

  it("updates the role when allowed", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      status: 200,
      role: "owner",
      clerkUserId: "u1",
    });
    vi.mocked(userRoleStore.listRoles).mockResolvedValue([
      {
        clerkUserId: "u1",
        role: "owner",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        clerkUserId: "u2",
        role: "member",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await PATCH(makeRequest({ role: "admin" }), {
      params: Promise.resolve({ clerkUserId: "u2" }),
    });
    expect(res.status).toBe(200);
    expect(userRoleStore.upsertRole).toHaveBeenCalledWith("u2", "admin");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w web`
Expected: FAIL — `route.ts` does not exist.

- [ ] **Step 3: Implement the route handler**

```ts
// packages/web/src/app/admin/api/users/[clerkUserId]/role/route.ts
import { NextResponse } from "next/server";
import { wouldRemoveLastOwner, type Role } from "core";
import { requireRole } from "@/lib/auth";
import { userRoleStore } from "@/lib/db";

const VALID_ROLES: Role[] = ["owner", "admin", "member"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clerkUserId: string }> },
) {
  const guard = await requireRole(["owner"]);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { clerkUserId } = await params;
  const body = await request.json();
  const newRole = body.role;

  if (!VALID_ROLES.includes(newRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const currentRoles = await userRoleStore.listRoles();
  if (wouldRemoveLastOwner(currentRoles, clerkUserId, newRole)) {
    return NextResponse.json(
      { error: "Cannot remove the last remaining Super Admin" },
      { status: 409 },
    );
  }

  await userRoleStore.upsertRole(clerkUserId, newRole);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w web`
Expected: PASS — 4 new tests.

- [ ] **Step 5: Commit**

```bash
git add "packages/web/src/app/admin/api/users/[clerkUserId]"
git commit -m "feat(web): add PATCH /admin/api/users/:clerkUserId/role route"
```

---

## Task 10: Web — `/admin` UI (user table + invite modal)

**Files:**
- Create: `packages/web/src/app/admin/page.tsx`
- Create: `packages/web/src/app/admin/AdminUserTable.tsx`
- Create: `packages/web/src/app/admin/InviteUserModal.tsx`

**Interfaces:**
- Consumes: `AdminUserRow` from Task 7's `@/lib/adminUsers`; `getCurrentUserRole` from Task 6's `@/lib/auth`; `GET /admin/api/users`, `POST /admin/api/users/invite`, `PATCH /admin/api/users/:id/role` from Tasks 7–9.

No automated tests for this task per spec scope (no E2E/browser tests this slice) — verified
manually via the dev server.

- [ ] **Step 1: Write the admin page (server component)**

```tsx
// packages/web/src/app/admin/page.tsx
import { getCurrentUserRole } from "@/lib/auth";
import { listUsersForAdmin } from "@/lib/adminUsers";
import { AdminUserTable } from "./AdminUserTable";

export default async function AdminPage() {
  const current = await getCurrentUserRole();
  const users = await listUsersForAdmin();
  const canManage = current?.role === "owner";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">Users</h1>
      <AdminUserTable initialUsers={users} canManage={canManage} />
    </div>
  );
}
```

- [ ] **Step 2: Write the user table (client component)**

```tsx
// packages/web/src/app/admin/AdminUserTable.tsx
"use client";

import { useState } from "react";
import type { AdminUserRow } from "@/lib/adminUsers";
import { InviteUserModal } from "./InviteUserModal";

const ROLE_LABELS: Record<string, string> = {
  owner: "Super Admin",
  admin: "Admin",
  member: "Member",
};

export function AdminUserTable({
  initialUsers,
  canManage,
}: {
  initialUsers: AdminUserRow[];
  canManage: boolean;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(userId: string, newRole: string) {
    const previous = users;
    setUsers((rows) =>
      rows.map((r) =>
        r.id === userId ? { ...r, role: newRole as AdminUserRow["role"] } : r,
      ),
    );
    setError(null);

    const res = await fetch(`/admin/api/users/${userId}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });

    if (!res.ok) {
      setUsers(previous);
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to update role");
    }
  }

  return (
    <div>
      {canManage && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="mb-4 rounded bg-teal-600 px-3 py-2 text-sm font-medium text-white"
        >
          Invite user
        </button>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2">Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-2">{u.name ?? "—"}</td>
              <td>{u.email ?? "—"}</td>
              <td>
                {canManage ? (
                  <select
                    value={u.role ?? ""}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    className="rounded border px-2 py-1"
                  >
                    <option value="" disabled>
                      Pending
                    </option>
                    <option value="owner">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  (u.role && ROLE_LABELS[u.role]) || "Pending"
                )}
              </td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {inviteOpen && <InviteUserModal onClose={() => setInviteOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Write the invite modal (client component)**

```tsx
// packages/web/src/app/admin/InviteUserModal.tsx
"use client";

import { useState, type FormEvent } from "react";

const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

export function InviteUserModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!GMAIL_PATTERN.test(email)) {
      setError("Email must be a @gmail.com address");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch("/admin/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });

    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to send invite");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="w-80 rounded bg-white p-4 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold">Invite user</h2>
        <label className="mb-2 block text-sm">
          Gmail address
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="friend@gmail.com"
            required
          />
        </label>
        <label className="mb-3 block text-sm">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="mt-1 w-full rounded border px-2 py-1"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        </label>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-teal-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            Send invite
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Build to confirm everything compiles**

Run: `npm run build -w web`
Expected: succeeds.

- [ ] **Step 5: Manual verification (requires Ticket E1 keys, a signed-in Super Admin account)**

Run: `npm run dev -w web`, sign in as the bootstrap Super Admin, visit `/admin`.
Expected: user table renders with your own row as "Super Admin"; "Invite user" opens the modal;
inviting a non-gmail address shows the inline error without a network call; inviting a
`friend@gmail.com` address succeeds and the invite appears in the Clerk dashboard; changing another
user's role updates the table immediately.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/admin/page.tsx packages/web/src/app/admin/AdminUserTable.tsx packages/web/src/app/admin/InviteUserModal.tsx
git commit -m "feat(web): add /admin user table and invite UI"
```

---

## GitHub Tracking

Milestone: "v0.1 — Super Admin UI" (github.com/pete-the-pete/mangoes/milestone/1).
Project board: "Mango Tracker — v0.1 Super Admin UI" (github.com/users/pete-the-pete/projects/7).

- Issue #3 (E1) blocks Task 5's issue (Step 6), Task 6's issue (Step 8), Task 10's issue (Step 5) — manual-verification steps only.
- Issue #4 (E2) blocks Issue #5 (E3).
- Issues #3 + #4 block Issue #5 (E3) — production deploy only, no local task depends on it.
- Issues #6 → #7 → #8 → #9 are sequential (core, Tasks 1–4).
- Issue #10 (Task 5) depends on #9 (Task 4) and #3 (E1) for its manual-verification step only.
- Issue #11 (Task 6) depends on #9 and #10.
- Issues #12, #13, #14 (Tasks 7, 8, 9) each depend on #11 (Task 6); they are otherwise independent of each other.
- Issue #15 (Task 10) depends on #11, #12, #13, #14.
