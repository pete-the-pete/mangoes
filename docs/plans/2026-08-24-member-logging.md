# Member Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first member-facing surface — one-tap logging against a session's item types, an
append-only ledger, an offline queue with PWA install, and a live leaderboard that converges across
everyone's phones.

**Architecture:** `packages/core` gains a `ledger` module — an append-only table whose per-cycle
sequence is assigned under a row lock, plus a pure fold that turns a delta stream into leaderboard
counts. `packages/web` adds a member API namespace (`/api/*`) gated on session participation rather
than platform role, a client sync layer over IndexedDB (aggregate + cursor + outbox), and the member
UI. Admin-only untagged and on-behalf logging extends v0.2's admin namespace.

**Tech Stack:** Plain TypeScript (`packages/core`), Next.js App Router (`packages/web`), Postgres via
`pg`, Clerk for auth, `idb` for IndexedDB, Vitest, Docker Compose for local Postgres.

**Spec:** [`docs/specs/2026-08-24-member-logging-design.md`](../specs/2026-08-24-member-logging-design.md)

**Tracking:** Milestone [v0.3 — Member Logging](https://github.com/pete-the-pete/mangoes/milestone/3).
Each task below names its GitHub issue. Issue bodies carry the same acceptance criteria; **this plan
is the source** — if they disagree, fix the issue, not the plan.

## Global Constraints

- TypeScript strict mode everywhere, no implicit `any` (root `CLAUDE.md`).
- `packages/core` may never import from `packages/web`, Next.js, or Clerk, and may never contain
  app-specific nouns — "mango," "group," "session," "trip," "day," "wager" (root `CLAUDE.md`).
  Core says `Cohort`, `Cycle`, `ItemType`, `LedgerEntry`; web maps those to Group / Session / item.
- npm workspaces (not Turborepo/pnpm). Node.js >= 26.7.0.
- `packages/core` uses `.js` import extensions (NodeNext). `packages/web` uses extensionless relative
  imports and the `@/` alias — it is `moduleResolution: bundler`.
- `core`'s `main`/`types` point at a gitignored `dist/`, so **`npm run build -w core` must precede any
  `web` build, test, or dev run.** Root `npm run build` does both in order.
- New `schema.sql` statements must be idempotent (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) — `runMigrations` replays
  the whole file on every boot.
- One new runtime dependency in this milestone: `idb`. One new devDependency: `fake-indexeddb`.
- Functional Tailwind only. **No Mango/Mexico/beach theming** — that is v0.4. Member UI is built with
  semantic component boundaries (`TapTarget`, `Leaderboard`, `SyncBadge`, `EntryList`) so v0.4 is a
  re-skin, not a rewrite.
- The word "shared" never appears on a member screen. It is admin vocabulary only.
- No E2E/browser tests. UI tasks are verified manually against the dev server; the offline path has a
  written checklist in Task 16.

## Testing Conventions (read before writing any test)

**These are the conventions v0.1 and v0.2 actually shipped**, which differ from the spec's Testing
section in one respect — the spec says web route tests run "against a test Postgres," and they do
not. Follow this section; the spec is corrected in the same commit as this plan.

- **`packages/core` store tests hit a real local Postgres.** No DB mocking. Every store test file
  begins with the guard the shipped stores use: read `process.env["DATABASE_URL"]`, throw if unset,
  and **refuse to run if the hostname is not `localhost`/`127.0.0.1`**, because the tests issue
  `DELETE FROM`. Copy that block verbatim from `packages/core/src/cycles/cycleStore.test.ts:7-18`.
- **`packages/core` pure-function tests** (`fold.ts`, `cycleStatus.ts`) need no database at all.
- **`packages/web` route handler tests mock the store layer**, not Postgres. The established shape is
  `vi.mock("@/lib/db", () => ({ … }))` plus `vi.mock("@/lib/cohortAuth", …)` / `vi.mock("@/lib/auth", …)`,
  then import the route's `GET`/`POST` directly and call it with a `Request` and a
  `{ params: Promise.resolve({...}) }` context. See
  `packages/web/tests/integration/admin-api/group-sessions.test.ts:1-40`.
- **`packages/web` client-side tests** live under `tests/unit/lib/` and use `fake-indexeddb`.
- Run core tests with `npm run test -w core`, web tests with `npm run test -w web`.
- Local Postgres: `docker compose up -d`, then `npm run migrate -w core && npm run seed -w web`.

## File Structure

**`packages/core`** — one new module plus two additions to shipped ones:

| File | Responsibility |
|---|---|
| `src/ledger/types.ts` | `LedgerEntry`, `LedgerEntryKind`, `AppendOp`, `AppendResult`, `Aggregate`, `SubjectKey`, `UNTAGGED` |
| `src/ledger/fold.ts` | `foldEntries`, `emptyAggregate`, `groupTotal` — pure, no I/O |
| `src/ledger/ledgerStore.ts` | `LedgerStore` interface + `createPostgresLedgerStore` |
| `src/ledger/index.ts` | Re-exports |
| `src/cycles/currentCycleStore.ts` | `CurrentCycleStore` — the per-user session pointer |
| `src/cycles/cycleStore.ts` | **Modified** — adds `listCyclesForParticipant`, `isCycleParticipant` |
| `src/cycles/index.ts` | **Modified** — re-exports `currentCycleStore` |
| `src/db/schema.sql` | **Modified by Tasks 1 and 3** — see the collision note below |
| `src/index.ts` | **Modified** — re-exports `ledger` |

**`packages/web`:**

| File | Responsibility |
|---|---|
| `src/lib/cycleAuth.ts` | `requireCycleParticipant` — the participation gate |
| `src/lib/db.ts` | **Modified** — exports `ledgerStore`, `currentCycleStore` |
| `src/lib/memberSessions.ts` | Pure shaping/validation for member session JSON |
| `src/lib/sync/store.ts` | IndexedDB: `cursor`, `counts`, `outbox`, `myEntries` |
| `src/lib/sync/client.ts` | Cold open, delta pull, flush, transport selection |
| `src/lib/sync/transport.ts` | `pickTransport` — Network Information API, pure and testable |
| `src/app/(member)/layout.tsx` | Signed-in gate for member pages |
| `src/app/(member)/page.tsx` | `/` — session screen or chooser |
| `src/app/(member)/sessions/**` | Session list, live session screen, your-logs |
| `src/app/(member)/groups/[groupId]/page.tsx` | Member roster view |
| `src/app/api/sessions/**` | Member route handlers |
| `src/app/api/current-session/route.ts` | Current-session toggle |
| `src/app/admin/api/groups/[groupId]/sessions/[sessionId]/entries/**` | Admin on-behalf / untagged / void |
| `public/manifest.webmanifest`, `public/sw.js` | PWA |

**Schema collision:** Tasks 1 and 3 both append to `packages/core/src/db/schema.sql`. They are
logically independent but textually collide. Merge them in numeric order, or expect a trivial
conflict on rebase — resolve by keeping **both** blocks, never by taking one side wholesale.

---

## Task 1: Core — ledger schema, types, and `LedgerStore`

**GitHub issue:** [#55](https://github.com/pete-the-pete/mangoes/issues/55) · **Blocked by:** nothing

The substrate everything else sits on. The sequence-assignment strategy here is the single most
consequential decision in the milestone: get it wrong and logs vanish silently.

**Files:**
- Create: `packages/core/src/ledger/types.ts`
- Create: `packages/core/src/ledger/ledgerStore.ts`
- Create: `packages/core/src/ledger/index.ts`
- Create: `packages/core/src/ledger/ledgerStore.test.ts`
- Modify: `packages/core/src/db/schema.sql` (append)
- Modify: `packages/core/src/index.ts` (add one re-export line)

**Interfaces:**
- Consumes: v0.2's `cycles`, `cycle_participants`, `item_types` tables.
- Produces: `LedgerEntry`, `LedgerEntryKind`, `AppendOp`, `AppendContext`, `AppendResult`,
  `RejectReason`, `SubjectKey`, `UNTAGGED`, `LedgerStore`, `createPostgresLedgerStore`.

---

- [ ] **Step 1: Append the schema**

Add to the end of `packages/core/src/db/schema.sql`:

```sql
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS last_seq BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('log', 'void')),
  item_type_key TEXT NOT NULL REFERENCES item_types(key),
  subject_user_id TEXT,
  actor_user_id TEXT NOT NULL,
  voids_entry_id UUID REFERENCES ledger_entries(id),
  client_entry_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  -- clock_timestamp(), not now(): now() returns transaction-START time, and
  -- appends queue on the cycle row lock, so transactions that begin together
  -- would all share a timestamp and commit order would be unobservable. This
  -- column records when the row was actually written.
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (kind = 'log' OR voids_entry_id IS NOT NULL),
  UNIQUE (cycle_id, seq),
  UNIQUE (cycle_id, client_entry_id)
);

CREATE INDEX IF NOT EXISTS ledger_entries_cycle_seq_idx ON ledger_entries (cycle_id, seq);
CREATE INDEX IF NOT EXISTS ledger_entries_subject_idx ON ledger_entries (cycle_id, subject_user_id);
```

`subject_user_id` is nullable on purpose — `NULL` means untagged, credited to the group and to no
individual. That is how the spec reproduces the vision's "+0 to the individual, +1 to the group"
without an attribution enum.

- [ ] **Step 2: Write the types**

`packages/core/src/ledger/types.ts`:

```ts
/** Sentinel subject key for untagged entries — credited to the group, to no individual. */
export const UNTAGGED = "__untagged__";

/** A Clerk user id, or UNTAGGED. */
export type SubjectKey = string;

export type LedgerEntryKind = "log" | "void";

export interface LedgerEntry {
  id: string;
  cycleId: string;
  seq: number;
  kind: LedgerEntryKind;
  itemTypeKey: string;
  /** null = untagged. */
  subjectUserId: string | null;
  actorUserId: string;
  voidsEntryId: string | null;
  clientEntryId: string;
  occurredAt: Date;
  createdAt: Date;
}

export interface AppendOp {
  /** Client-generated UUID. The idempotency key. */
  clientEntryId: string;
  kind: LedgerEntryKind;
  /** Required for kind "log"; ignored for "void" (copied from the target). */
  itemTypeKey?: string | undefined;
  /** Required for kind "void" — resolves the target by client id, never server id. */
  voidsClientEntryId?: string | undefined;
  /**
   * For kind "log": omit to credit the actor; pass null explicitly for untagged.
   * Ignored for "void".
   */
  subjectUserId?: string | null | undefined;
  occurredAt: Date;
}

export interface AppendContext {
  actorUserId: string;
  /** False for members: a void whose target has a different subject is rejected. */
  canVoidOthers: boolean;
  /** False for members: any append to a closed cycle is rejected. */
  canWriteClosed: boolean;
  /** False for members: an explicit subjectUserId other than the actor is rejected. */
  canWriteForOthers: boolean;
}

export type RejectReason =
  | "cycle_closed"
  | "unknown_target"
  | "not_your_entry"
  | "already_voided"
  | "unknown_item_type"
  | "malformed_op";

export interface AppendResult {
  /** The cycle's sequence after this append. */
  cursor: number;
  accepted: string[];
  /** Already present. A normal outcome of a retried flush, never an error. */
  duplicates: string[];
  rejected: { clientEntryId: string; reason: RejectReason }[];
}

export interface Aggregate {
  cursor: number;
  /** counts[subjectKey][itemTypeKey] */
  counts: Record<SubjectKey, Record<string, number>>;
}

export interface DeltaPage {
  entries: LedgerEntry[];
  nextCursor: number;
  hasMore: boolean;
}
```

Note `cycle_closed`, not `session_closed` — core never says "session". `packages/web` maps it to
"Only a session admin can amend a closed session."

- [ ] **Step 3: Write the failing store tests**

`packages/core/src/ledger/ledgerStore.test.ts`. Copy the connection guard verbatim from
`packages/core/src/cycles/cycleStore.test.ts:7-18` — it refuses to run against a non-local database
because these tests `DELETE FROM`.

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createPostgresLedgerStore } from "./ledgerStore.js";
import { createPostgresCycleStore } from "../cycles/cycleStore.js";
import { createPostgresCohortStore } from "../cohorts/cohortStore.js";
import { runMigrations } from "../db/migrate.js";
import { UNTAGGED } from "./types.js";

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
const cohortStore = createPostgresCohortStore(pool);
const cycleStore = createPostgresCycleStore(pool);
const store = createPostgresLedgerStore(pool);

const MEMBER = { actorUserId: "u1", canVoidOthers: false, canWriteClosed: false, canWriteForOthers: false };
const ADMIN = { actorUserId: "a1", canVoidOthers: true, canWriteClosed: true, canWriteForOthers: true };

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

async function makeCycle() {
  const cohort = await cohortStore.createCohort({ name: "Cabo", createdBy: "a1" });
  return cycleStore.createCycle({
    cohortId: cohort.id,
    name: "Day 3",
    startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-08T00:00:00Z"),
    itemTypeKeys: ["mango", "taco"],
    participantIds: ["u1", "u2"],
    createdBy: "a1",
  });
}

function log(itemTypeKey = "mango") {
  return { clientEntryId: randomUUID(), kind: "log" as const, itemTypeKey, occurredAt: new Date() };
}

describe("createPostgresLedgerStore", () => {
  it("assigns a gapless sequence starting at 1", async () => {
    const cycle = await makeCycle();
    const result = await store.append(cycle.id, MEMBER, [log(), log(), log()]);
    expect(result.accepted).toHaveLength(3);
    expect(result.cursor).toBe(3);

    const page = await store.readSince(cycle.id, 0, 100);
    expect(page.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("treats a replayed client_entry_id as a duplicate, not an error", async () => {
    const cycle = await makeCycle();
    const op = log();
    await store.append(cycle.id, MEMBER, [op]);
    const second = await store.append(cycle.id, MEMBER, [op]);

    expect(second.duplicates).toEqual([op.clientEntryId]);
    expect(second.accepted).toEqual([]);
    // The replay must not consume a sequence.
    expect(second.cursor).toBe(1);
  });

  it("credits the actor by default and the group when subject is explicitly null", async () => {
    const cycle = await makeCycle();
    await store.append(cycle.id, MEMBER, [log()]);
    await store.append(cycle.id, ADMIN, [{ ...log(), subjectUserId: null }]);

    const aggregate = await store.snapshot(cycle.id);
    expect(aggregate.counts["u1"]?.["mango"]).toBe(1);
    expect(aggregate.counts[UNTAGGED]?.["mango"]).toBe(1);
  });

  it("voids by client id, copying the target's item and subject", async () => {
    const cycle = await makeCycle();
    const target = log();
    await store.append(cycle.id, MEMBER, [target]);
    await store.append(cycle.id, MEMBER, [
      { clientEntryId: randomUUID(), kind: "void", voidsClientEntryId: target.clientEntryId, occurredAt: new Date() },
    ]);

    const page = await store.readSince(cycle.id, 0, 100);
    const voidRow = page.entries[1]!;
    expect(voidRow.kind).toBe("void");
    expect(voidRow.itemTypeKey).toBe("mango");
    expect(voidRow.subjectUserId).toBe("u1");

    const aggregate = await store.snapshot(cycle.id);
    expect(aggregate.counts["u1"]?.["mango"] ?? 0).toBe(0);
  });

  it("rejects a member voiding someone else's entry", async () => {
    const cycle = await makeCycle();
    const target = log();
    await store.append(cycle.id, { ...MEMBER, actorUserId: "u2" }, [target]);
    const result = await store.append(cycle.id, MEMBER, [
      { clientEntryId: randomUUID(), kind: "void", voidsClientEntryId: target.clientEntryId, occurredAt: new Date() },
    ]);
    expect(result.rejected[0]?.reason).toBe("not_your_entry");
  });

  it("rejects an unknown void target but still applies the rest of the batch", async () => {
    const cycle = await makeCycle();
    const good = log();
    const result = await store.append(cycle.id, MEMBER, [
      { clientEntryId: randomUUID(), kind: "void", voidsClientEntryId: randomUUID(), occurredAt: new Date() },
      good,
    ]);
    expect(result.rejected[0]?.reason).toBe("unknown_target");
    expect(result.accepted).toEqual([good.clientEntryId]);
  });

  it("rejects a member write to a closed cycle and allows an admin's", async () => {
    const cycle = await makeCycle();
    await cycleStore.closeCycle(cycle.id, "a1");

    const denied = await store.append(cycle.id, MEMBER, [log()]);
    expect(denied.rejected[0]?.reason).toBe("cycle_closed");

    const allowed = await store.append(cycle.id, ADMIN, [log()]);
    expect(allowed.accepted).toHaveLength(1);
  });

  it("pages deltas and reports hasMore", async () => {
    const cycle = await makeCycle();
    await store.append(cycle.id, MEMBER, [log(), log(), log()]);

    const first = await store.readSince(cycle.id, 0, 2);
    expect(first.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.nextCursor).toBe(2);
    expect(first.hasMore).toBe(true);

    const second = await store.readSince(cycle.id, first.nextCursor, 2);
    expect(second.entries.map((e) => e.seq)).toEqual([3]);
    expect(second.hasMore).toBe(false);
  });

  // The test that justifies the entire design. Without it, the row-lock argument
  // is an assertion rather than a fact, and a future refactor to bigserial passes
  // every other test in this file while silently losing entries.
  it("keeps the sequence gapless and commit-ordered under concurrent appends", async () => {
    const cycle = await makeCycle();
    const BATCHES = 20;

    await Promise.all(
      Array.from({ length: BATCHES }, () => store.append(cycle.id, MEMBER, [log()])),
    );

    const page = await store.readSince(cycle.id, 0, 1000);
    const seqs = page.entries.map((e) => e.seq);
    expect(seqs).toHaveLength(BATCHES);
    expect(seqs).toEqual(Array.from({ length: BATCHES }, (_, i) => i + 1));

    // Commit order matches sequence order: created_at is non-decreasing across seq.
    const times = page.entries.map((e) => e.createdAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
docker compose up -d
npm run test -w core -- ledgerStore
```

Expected: FAIL — `createPostgresLedgerStore` is not exported from `./ledgerStore.js`.

- [ ] **Step 5: Implement the store**

`packages/core/src/ledger/ledgerStore.ts`. The sequencing strategy is the whole point — read the
comment before changing anything here.

```ts
import type { Pool } from "pg";
import type {
  Aggregate, AppendContext, AppendOp, AppendResult, DeltaPage,
  LedgerEntry, RejectReason,
} from "./types.js";
import { UNTAGGED } from "./types.js";

export interface LedgerStore {
  append(cycleId: string, ctx: AppendContext, ops: AppendOp[]): Promise<AppendResult>;
  readSince(cycleId: string, afterSeq: number, limit: number): Promise<DeltaPage>;
  snapshot(cycleId: string): Promise<Aggregate>;
  listEntriesForSubject(cycleId: string, subjectUserId: string): Promise<LedgerEntry[]>;
  /** By server id — the admin void route clicks a row the server rendered. */
  getEntryById(cycleId: string, entryId: string): Promise<LedgerEntry | undefined>;
}

interface EntryRow {
  id: string;
  cycle_id: string;
  seq: string; // bigint arrives as string from pg
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
      const rejected: { clientEntryId: string; reason: RejectReason }[] = [];

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
        const cycleRes = await client.query<{ closed_at: Date | null; last_seq: string }>(
          "SELECT closed_at, last_seq FROM cycles WHERE id = $1 FOR UPDATE",
          [cycleId],
        );
        const cycleRow = cycleRes.rows[0];
        if (!cycleRow) {
          await client.query("ROLLBACK");
          return { cursor: 0, accepted: [], duplicates: [], rejected: [] };
        }

        const closed = cycleRow.closed_at !== null;
        let seq = Number(cycleRow.last_seq);

        // One round trip to find replays, so a duplicate never consumes a sequence.
        const clientIds = ops.map((o) => o.clientEntryId);
        const existing = await client.query<{ client_entry_id: string }>(
          "SELECT client_entry_id FROM ledger_entries WHERE cycle_id = $1 AND client_entry_id = ANY($2::uuid[])",
          [cycleId, clientIds],
        );
        const seen = new Set(existing.rows.map((r) => r.client_entry_id));

        // Item types are validated UP FRONT, not by catching the foreign key
        // violation. In Postgres a failed statement poisons the whole
        // transaction — every later statement errors until rollback — so one bad
        // key would take the rest of the batch down with it.
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
            // Resolve by client id — offline, the voider may never have seen a server id.
            const targetRes = await client.query<EntryRow>(
              `SELECT ${ENTRY_COLUMNS} FROM ledger_entries
               WHERE cycle_id = $1 AND client_entry_id = $2`,
              [cycleId, op.voidsClientEntryId],
            );
            const target = targetRes.rows[0];
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
            if (already.rowCount && already.rowCount > 0) {
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
            [cycleId, seq, op.kind, itemTypeKey, subjectUserId, ctx.actorUserId,
             voidsEntryId, op.clientEntryId, op.occurredAt],
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
      // Fetch one extra row to answer hasMore without a second COUNT query.
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
      // hand back a cursor that is ahead of the counts.
      const result = await pool.query<{
        cursor: string; subject: string; item_type_key: string | null; count: string | null;
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
        if (!row.item_type_key || row.count === null) continue; // the LEFT JOIN's empty case
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
```

- [ ] **Step 6: Add the barrel exports**

`packages/core/src/ledger/index.ts`:

```ts
export * from "./types.js";
export * from "./ledgerStore.js";
```

Add to `packages/core/src/index.ts`, after the existing `cycles` line:

```ts
export * from "./ledger/index.js";
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run test -w core -- ledgerStore
npm run typecheck -w core
```

Expected: all 9 tests PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ledger packages/core/src/db/schema.sql packages/core/src/index.ts
git commit -m "feat(core): append-only ledger with per-cycle sequencing

Closes #55"
```

---

## Task 2: Core — `foldEntries`, the pure delta fold

**GitHub issue:** [#56](https://github.com/pete-the-pete/mangoes/issues/56) · **Blocked by:** #55

Every client turns a stream of deltas into leaderboard counts with this function. It has no I/O, so
this is where cheap tests buy the most.

**Files:**
- Create: `packages/core/src/ledger/fold.ts`
- Create: `packages/core/src/ledger/fold.test.ts`
- Modify: `packages/core/src/ledger/index.ts` (one line)

**Interfaces:**
- Consumes: `LedgerEntry`, `Aggregate`, `SubjectKey`, `UNTAGGED` from Task 1.
- Produces: `emptyAggregate()`, `foldEntries(aggregate, entries)`, `groupTotal(aggregate, itemTypeKey)`,
  `subjectTotal(aggregate, subjectKey, itemTypeKey)`.

---

- [ ] **Step 1: Write the failing tests**

`packages/core/src/ledger/fold.test.ts`. No database — this file imports nothing with I/O.

```ts
import { describe, it, expect } from "vitest";
import { emptyAggregate, foldEntries, groupTotal, subjectTotal } from "./fold.js";
import { UNTAGGED, type LedgerEntry } from "./types.js";

function entry(over: Partial<LedgerEntry> & { seq: number }): LedgerEntry {
  return {
    id: `e${over.seq}`,
    cycleId: "c1",
    kind: "log",
    itemTypeKey: "mango",
    subjectUserId: "u1",
    actorUserId: "u1",
    voidsEntryId: null,
    clientEntryId: `ce${over.seq}`,
    occurredAt: new Date(),
    createdAt: new Date(),
    ...over,
  };
}

describe("foldEntries", () => {
  it("returns the empty aggregate unchanged for no entries", () => {
    const result = foldEntries(emptyAggregate(), []);
    expect(result).toEqual({ cursor: 0, counts: {} });
  });

  it("adds 1 per log and subtracts 1 per void", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1 }),
      entry({ seq: 2 }),
      entry({ seq: 3, kind: "void", voidsEntryId: "e1" }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(result.cursor).toBe(3);
  });

  it("counts untagged entries toward the group but toward no individual", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1, subjectUserId: "u1" }),
      entry({ seq: 2, subjectUserId: null }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(subjectTotal(result, UNTAGGED, "mango")).toBe(1);
    expect(groupTotal(result, "mango")).toBe(2);
  });

  it("is order-independent — a void arriving before its target lands the same", () => {
    const forward = foldEntries(emptyAggregate(), [
      entry({ seq: 1 }),
      entry({ seq: 2, kind: "void", voidsEntryId: "e1" }),
    ]);
    const reversed = foldEntries(emptyAggregate(), [
      entry({ seq: 2, kind: "void", voidsEntryId: "e1" }),
      entry({ seq: 1 }),
    ]);
    expect(forward.counts).toEqual(reversed.counts);
  });

  it("ignores a delta at or below the current cursor, so replays cannot double-count", () => {
    const once = foldEntries(emptyAggregate(), [entry({ seq: 1 }), entry({ seq: 2 })]);
    const twice = foldEntries(once, [entry({ seq: 1 }), entry({ seq: 2 })]);
    expect(subjectTotal(twice, "u1", "mango")).toBe(2);
    expect(twice.cursor).toBe(2);
  });

  it("never mutates the aggregate it is given", () => {
    const before = foldEntries(emptyAggregate(), [entry({ seq: 1 })]);
    const snapshot = structuredClone(before);
    foldEntries(before, [entry({ seq: 2 })]);
    expect(before).toEqual(snapshot);
  });

  it("keeps counts separated per item type", () => {
    const result = foldEntries(emptyAggregate(), [
      entry({ seq: 1, itemTypeKey: "mango" }),
      entry({ seq: 2, itemTypeKey: "taco" }),
      entry({ seq: 3, itemTypeKey: "taco" }),
    ]);
    expect(subjectTotal(result, "u1", "mango")).toBe(1);
    expect(subjectTotal(result, "u1", "taco")).toBe(2);
  });

  it("advances the cursor to the highest sequence seen", () => {
    const result = foldEntries(emptyAggregate(), [entry({ seq: 7 }), entry({ seq: 4 })]);
    expect(result.cursor).toBe(7);
  });
});
```

The replay test is the one that matters most: the client folds the same entries from a snapshot, a
polled delta, and an SSE push, and any of those can overlap.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test -w core -- fold
```

Expected: FAIL — `emptyAggregate` is not exported from `./fold.js`.

- [ ] **Step 3: Implement the fold**

`packages/core/src/ledger/fold.ts`:

```ts
import { UNTAGGED, type Aggregate, type LedgerEntry, type SubjectKey } from "./types.js";

export function emptyAggregate(): Aggregate {
  return { cursor: 0, counts: {} };
}

/**
 * Folds a delta stream into leaderboard counts. Pure: never mutates its input,
 * never touches I/O, and safe to call with entries the aggregate has already seen.
 *
 * Entries at or below the current cursor are skipped, which is what makes overlap
 * between the snapshot, a polled delta, and an SSE push harmless.
 */
export function foldEntries(aggregate: Aggregate, entries: LedgerEntry[]): Aggregate {
  let cursor = aggregate.cursor;
  const counts: Record<SubjectKey, Record<string, number>> = {};
  for (const [subject, byItem] of Object.entries(aggregate.counts)) {
    counts[subject] = { ...byItem };
  }

  for (const entry of entries) {
    if (entry.seq <= aggregate.cursor) continue;
    const subject = entry.subjectUserId ?? UNTAGGED;
    const byItem = (counts[subject] ??= {});
    byItem[entry.itemTypeKey] = (byItem[entry.itemTypeKey] ?? 0) + (entry.kind === "log" ? 1 : -1);
    if (entry.seq > cursor) cursor = entry.seq;
  }

  return { cursor, counts };
}

/** One person's count for one item type. */
export function subjectTotal(aggregate: Aggregate, subject: SubjectKey, itemTypeKey: string): number {
  return aggregate.counts[subject]?.[itemTypeKey] ?? 0;
}

/** Everyone's count for one item type, untagged entries included. */
export function groupTotal(aggregate: Aggregate, itemTypeKey: string): number {
  let total = 0;
  for (const byItem of Object.values(aggregate.counts)) {
    total += byItem[itemTypeKey] ?? 0;
  }
  return total;
}
```

- [ ] **Step 3b: Pin the fold against the SQL aggregate**

Add to `packages/core/src/ledger/ledgerStore.test.ts`. `snapshot()` computes counts in SQL for a cold
open; every client computes the same counts by folding deltas. Nothing otherwise forces those two
implementations to agree, and if they drift a member's leaderboard quietly depends on whether they
opened cold or caught up — a divergence that never surfaces as an error.

```ts
it("agrees with foldEntries over the same history", async () => {
  const cycle = await makeCycle();
  const mine = log("mango");
  await store.append(cycle.id, MEMBER, [mine, log("taco")]);
  await store.append(cycle.id, { ...MEMBER, actorUserId: "u2" }, [log("mango"), log("mango")]);
  await store.append(cycle.id, ADMIN, [{ ...log("taco"), subjectUserId: null }]);
  await store.append(cycle.id, ADMIN, [{ ...log("mango"), subjectUserId: "u2" }]);
  await store.append(cycle.id, MEMBER, [voidOf(mine.clientEntryId)]);

  const fromSql = await store.snapshot(cycle.id);
  const all = await store.readSince(cycle.id, 0, 1000);
  const fromFold = foldEntries(emptyAggregate(), all.entries);

  expect(fromFold.counts).toEqual(fromSql.counts);
  expect(fromFold.cursor).toBe(fromSql.cursor);
  // Not a vacuous pass: the history above exercises every branch.
  expect(fromSql.counts["u1"]?.["mango"]).toBe(0);
  expect(fromSql.counts["u2"]?.["mango"]).toBe(3);
  expect(fromSql.counts[UNTAGGED]?.["taco"]).toBe(1);
});
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/ledger/index.ts`:

```ts
export * from "./fold.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test -w core -- fold
npm run typecheck -w core
```

Expected: all 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ledger
git commit -m "feat(core): pure delta fold for leaderboard counts

Closes #56"
```

---

## Task 3: Core — current-session pointer and participant-scoped cycle queries

**GitHub issue:** [#57](https://github.com/pete-the-pete/mangoes/issues/57) · **Blocked by:** nothing

Two additions v0.2 did not need. Its `CycleStore` is cohort-scoped only — there is no way to ask
"which sessions is this user in?" or "is this user a participant?", and every member route needs both.

**Files:**
- Create: `packages/core/src/cycles/currentCycleStore.ts`
- Create: `packages/core/src/cycles/currentCycleStore.test.ts`
- Modify: `packages/core/src/cycles/cycleStore.ts` (two new interface methods + implementations)
- Modify: `packages/core/src/cycles/cycleStore.test.ts` (two new tests)
- Modify: `packages/core/src/cycles/index.ts` (one line)
- Modify: `packages/core/src/db/schema.sql` (append — collides textually with Task 1)

**Interfaces:**
- Produces: `CurrentCycleStore`, `createPostgresCurrentCycleStore`,
  `CycleStore.listCyclesForParticipant(clerkUserId)`, `CycleStore.isCycleParticipant(cycleId, clerkUserId)`.

---

- [ ] **Step 1: Append the schema**

```sql
CREATE TABLE IF NOT EXISTS user_current_cycle (
  clerk_user_id TEXT PRIMARY KEY,
  cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cycle_participants_user_idx ON cycle_participants (clerk_user_id);
```

The index mirrors the existing `cohort_members_user_idx`. Both new queries filter on that column and
v0.2 shipped without it.

- [ ] **Step 2: Write the failing tests**

`packages/core/src/cycles/currentCycleStore.test.ts`. Same connection guard as every other core store
test — copy from `cycleStore.test.ts:7-18`.

```ts
describe("createPostgresCurrentCycleStore", () => {
  it("returns undefined when no pointer is set", async () => {
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("stores and resolves a pointer for a participant of a live cycle", async () => {
    const cycle = await makeCycle();               // participants: u1, u2
    await store.setCurrentCycle("u1", cycle.id);
    expect((await store.getCurrentCycle("u1"))?.id).toBe(cycle.id);
  });

  it("replaces rather than duplicates on a second set", async () => {
    const a = await makeCycle();
    const b = await makeCycle();
    await store.setCurrentCycle("u1", a.id);
    await store.setCurrentCycle("u1", b.id);
    expect((await store.getCurrentCycle("u1"))?.id).toBe(b.id);
  });

  it("ignores a pointer at a closed cycle", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await cycleStore.closeCycle(cycle.id, "a1");
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("ignores a pointer once the user is no longer a participant", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    // v0.2's group-removal flow does exactly this for open sessions.
    await pool.query("DELETE FROM cycle_participants WHERE cycle_id = $1 AND clerk_user_id = $2",
      [cycle.id, "u1"]);
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("drops the pointer when the cycle is deleted", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await pool.query("DELETE FROM cycles WHERE id = $1", [cycle.id]);
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });

  it("clears an explicitly cleared pointer", async () => {
    const cycle = await makeCycle();
    await store.setCurrentCycle("u1", cycle.id);
    await store.clearCurrentCycle("u1");
    expect(await store.getCurrentCycle("u1")).toBeUndefined();
  });
});
```

Add to `packages/core/src/cycles/cycleStore.test.ts`:

```ts
it("lists only the cycles a user participates in, newest window first", async () => {
  const mine = await makeCycleWith(["u1"]);
  await makeCycleWith(["u2"]);
  const result = await store.listCyclesForParticipant("u1");
  expect(result.map((c) => c.id)).toEqual([mine.id]);
});

it("answers participation without loading the whole cycle", async () => {
  const cycle = await makeCycleWith(["u1"]);
  expect(await store.isCycleParticipant(cycle.id, "u1")).toBe(true);
  expect(await store.isCycleParticipant(cycle.id, "u9")).toBe(false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm run test -w core -- currentCycleStore cycleStore
```

Expected: FAIL — `createPostgresCurrentCycleStore` undefined; `listCyclesForParticipant` is not a function.

- [ ] **Step 4: Implement the current-cycle store**

`packages/core/src/cycles/currentCycleStore.ts`:

```ts
import type { Pool } from "pg";
import type { CycleDetail } from "./types.js";

export interface CurrentCycleStore {
  /**
   * Resolves the stored pointer, or undefined. Validated on read, never trusted:
   * the row must exist, the user must still be a participant, and the cycle must
   * not be closed. A stale pointer is not an error — the caller renders a chooser.
   */
  getCurrentCycle(clerkUserId: string): Promise<CycleDetail | undefined>;
  setCurrentCycle(clerkUserId: string, cycleId: string): Promise<void>;
  clearCurrentCycle(clerkUserId: string): Promise<void>;
}

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
         JOIN cycle_participants p ON p.cycle_id = c.id AND p.clerk_user_id = u.clerk_user_id
         WHERE u.clerk_user_id = $1 AND c.closed_at IS NULL`,
        [clerkUserId],
      );
      const row = result.rows[0];
      return row ? readDetail(row.cycle_id) : undefined;
    },

    async setCurrentCycle(clerkUserId, cycleId) {
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
```

The `readDetail` injection keeps this store from duplicating `cycleStore`'s detail assembly. Wire it
in `packages/web/src/lib/db.ts` as `createPostgresCurrentCycleStore(pool, (id) => cycleStore.getCycle(id))`.

- [ ] **Step 5: Add the two `CycleStore` methods**

Add to the `CycleStore` interface in `packages/core/src/cycles/cycleStore.ts`:

```ts
  listCyclesForParticipant(clerkUserId: string): Promise<CycleDetail[]>;
  isCycleParticipant(cycleId: string, clerkUserId: string): Promise<boolean>;
```

And to `createPostgresCycleStore`'s returned object:

```ts
    async listCyclesForParticipant(clerkUserId) {
      const result = await pool.query<{ id: string }>(
        `SELECT c.id
         FROM cycles c
         JOIN cycle_participants p ON p.cycle_id = c.id
         WHERE p.clerk_user_id = $1
         ORDER BY c.starts_at DESC`,
        [clerkUserId],
      );
      const details = await Promise.all(result.rows.map((r) => readDetail(pool, r.id)));
      return details.filter((d): d is CycleDetail => d !== undefined);
    },

    async isCycleParticipant(cycleId, clerkUserId) {
      const result = await pool.query(
        "SELECT 1 FROM cycle_participants WHERE cycle_id = $1 AND clerk_user_id = $2",
        [cycleId, clerkUserId],
      );
      return (result.rowCount ?? 0) > 0;
    },
```

`readDetail` is the module-level helper already in that file at line ~80. `isCycleParticipant` is a
single indexed lookup on purpose — it runs on every member API request and must not load participant
and item-type lists it will not use.

- [ ] **Step 6: Export and verify**

Add `export * from "./currentCycleStore.js";` to `packages/core/src/cycles/index.ts`, then:

```bash
npm run test -w core -- currentCycleStore cycleStore
npm run typecheck -w core
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/cycles packages/core/src/db/schema.sql
git commit -m "feat(core): current-cycle pointer and participant-scoped cycle queries

Closes #57"
```

---

## Task 4: Web — `requireCycleParticipant` and the `(member)` route group

**GitHub issue:** [#58](https://github.com/pete-the-pete/mangoes/issues/58) · **Blocked by:** #57

The first authorization gate in this codebase that is not an admin gate. v0.1's `requireRole` checks
platform role; v0.2's `requireCohortRole` checks platform **and** group role. Both guard `/admin`.
This one checks participation and nothing else — it is what lets a plain platform `member` finally do
something, closing the gap v0.2 named explicitly.

**Files:**
- Create: `packages/web/src/lib/cycleAuth.ts`
- Create: `packages/web/tests/unit/lib/cycleAuth.test.ts`
- Create: `packages/web/src/app/(member)/layout.tsx`
- Modify: `packages/web/src/lib/db.ts`

**Interfaces:**
- Consumes: `getCurrentUserRole` from `@/lib/auth`, `CycleStore.isCycleParticipant` from Task 3.
- Produces: `requireCycleParticipant(cycleId)`, `CycleGuardResult`, and the `ledgerStore` /
  `currentCycleStore` singletons.

---

- [ ] **Step 1: Wire the new stores**

Add to `packages/web/src/lib/db.ts`:

```ts
import {
  createPostgresCurrentCycleStore,
  createPostgresLedgerStore,
  // ...existing imports
} from "core";

export const ledgerStore = createPostgresLedgerStore(pool);
export const currentCycleStore = createPostgresCurrentCycleStore(pool, (id) =>
  cycleStore.getCycle(id),
);
```

- [ ] **Step 2: Write the failing guard tests**

`packages/web/tests/unit/lib/cycleAuth.test.ts`, following the shape of the shipped
`cohortAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUserRole: vi.fn() }));
vi.mock("@/lib/db", () => ({ cycleStore: { isCycleParticipant: vi.fn() } }));

import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore } from "@/lib/db";
import { requireCycleParticipant } from "@/lib/cycleAuth";

beforeEach(() => {
  vi.mocked(getCurrentUserRole).mockReset();
  vi.mocked(cycleStore.isCycleParticipant).mockReset();
});

describe("requireCycleParticipant", () => {
  it("401s when nobody is signed in", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue(null);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 401 });
  });

  it("passes a plain platform member who participates", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "u1", role: "member" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(true);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: true, clerkUserId: "u1" });
  });

  it("403s a platform member who does not participate", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "u9", role: "member" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 403 });
  });

  it("403s a platform admin who does not participate — platform role grants nothing here", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "a1", role: "admin" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    expect(await requireCycleParticipant("s1")).toMatchObject({ ok: false, status: 403 });
  });

  it("passes the platform owner without checking participation", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "o1", role: "owner" });
    const result = await requireCycleParticipant("s1");
    expect(result).toMatchObject({ ok: true, isSuperuser: true });
    expect(cycleStore.isCycleParticipant).not.toHaveBeenCalled();
  });

  it("gives an identical 403 body whether the cycle is missing or the caller was removed", async () => {
    vi.mocked(getCurrentUserRole).mockResolvedValue({ clerkUserId: "u1", role: "member" });
    vi.mocked(cycleStore.isCycleParticipant).mockResolvedValue(false);
    const a = await requireCycleParticipant("missing");
    const b = await requireCycleParticipant("removed-from");
    expect(a.error).toBe(b.error);
  });
});
```

That last test is a requirement, not a nicety: a distinguishable response would let anyone probe
which session ids exist.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run build -w core && npm run test -w web -- cycleAuth`
Expected: FAIL — cannot resolve `@/lib/cycleAuth`.

- [ ] **Step 4: Implement the guard**

`packages/web/src/lib/cycleAuth.ts`:

```ts
import type { Role } from "core";
import { getCurrentUserRole } from "./auth";
import { cycleStore } from "./db";

export interface CycleGuardResult {
  ok: boolean;
  status: number;
  error?: string | undefined;
  clerkUserId?: string | undefined;
  platformRole?: Role | undefined;
  /** True when access came from platform owner, not participation. */
  isSuperuser?: boolean | undefined;
}

/**
 * Participation-only authorization for the member API. Unlike requireRole and
 * requireCohortRole, platform role grants nothing here — a platform admin who is
 * not in the session gets the same 403 as anyone else. Platform owner is the one
 * exception, matching the superuser escape hatch v0.1 and v0.2 established.
 *
 * Called inside each route handler. Route handlers do not run layouts.
 */
export async function requireCycleParticipant(cycleId: string): Promise<CycleGuardResult> {
  const current = await getCurrentUserRole();
  if (!current) {
    return { ok: false, status: 401, error: "Not signed in" };
  }

  if (current.role === "owner") {
    return {
      ok: true, status: 200, clerkUserId: current.clerkUserId,
      platformRole: "owner", isSuperuser: true,
    };
  }

  const participates = await cycleStore.isCycleParticipant(cycleId, current.clerkUserId);
  if (!participates) {
    // Deliberately identical whether the cycle is missing or the caller was
    // removed — otherwise this endpoint enumerates session ids.
    return { ok: false, status: 403, error: "Not authorized" };
  }

  return {
    ok: true, status: 200, clerkUserId: current.clerkUserId,
    platformRole: current.role, isSuperuser: false,
  };
}
```

- [ ] **Step 5: Add the member layout**

`packages/web/src/app/(member)/layout.tsx` — gates pages on being signed in only. Participation is a
per-resource question answered at the resource.

```tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

// Gates the member *pages* only, mirroring app/admin/layout.tsx. Route handlers
// under /api/* do not run layouts and call requireCycleParticipant themselves.
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  return <>{children}</>;
}
```

`proxy.ts` needs no change — its matcher already covers `/` and `/api/*`, and it still does no gating.

- [ ] **Step 6: Move the existing home page into the route group**

`git mv packages/web/src/app/page.tsx packages/web/src/app/(member)/page.tsx`. It keeps rendering the
splash for now; Task 13 replaces its body. Route groups do not affect the URL, so `/` is unchanged.

**Important:** `(member)/layout.tsx` redirects signed-out visitors, but `/` must stay reachable
signed-out. So do **not** put the splash under the gated layout — leave `app/page.tsx` where it is and
create the group for `/sessions` and `/groups` only. Task 13 handles `/`'s signed-in branch by
checking `auth()` inside the page.

- [ ] **Step 7: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- cycleAuth
npm run build -w web
git add packages/web/src/lib packages/web/src/app packages/web/tests
git commit -m "feat(web): participation-only auth gate and member route group

Closes #58"
```

---

## Task 5: Web — member sessions API

**GitHub issue:** [#59](https://github.com/pete-the-pete/mangoes/issues/59) · **Blocked by:** #57, #58

**Files:**
- Create: `packages/web/src/lib/memberSessions.ts`
- Create: `packages/web/src/app/api/sessions/route.ts`
- Create: `packages/web/src/app/api/current-session/route.ts`
- Create: `packages/web/tests/integration/member-api/sessions.test.ts`
- Create: `packages/web/tests/unit/lib/memberSessions.test.ts`

**Interfaces:**
- Consumes: `cycleStore.listCyclesForParticipant`, `currentCycleStore`, `deriveCycleStatus`,
  `isCycleOverdue`.
- Produces: `toMemberSessionJson(cycle, now)`, `splitByStatus(cycles, now)`, and the two routes.

---

- [ ] **Step 1: Write the failing shaping tests**

`packages/web/tests/unit/lib/memberSessions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitByStatus, toMemberSessionJson } from "@/lib/memberSessions";

const base = {
  id: "s1", cohortId: "c1", name: "Day 3",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-02T00:00:00Z"),
  closedAt: null, closedBy: null, createdBy: "a1",
  createdAt: new Date(), updatedAt: new Date(),
  participantIds: ["u1"], itemTypeKeys: ["mango"],
};

describe("toMemberSessionJson", () => {
  it("reports a cycle past its end but not closed as live and overdue", () => {
    const json = toMemberSessionJson(base, new Date("2026-09-05T00:00:00Z"));
    expect(json.status).toBe("live");
    expect(json.isOverdue).toBe(true);
  });

  it("serializes dates as ISO strings", () => {
    const json = toMemberSessionJson(base, new Date("2026-09-01T12:00:00Z"));
    expect(json.startsAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("splitByStatus", () => {
  it("groups into live, scheduled, and recent", () => {
    const scheduled = { ...base, id: "s2", startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z") };
    const closed = { ...base, id: "s3", closedAt: new Date("2026-09-02T00:00:00Z") };
    const result = splitByStatus([base, scheduled, closed], new Date("2026-09-01T12:00:00Z"));
    expect(result.live.map((s) => s.id)).toEqual(["s1"]);
    expect(result.scheduled.map((s) => s.id)).toEqual(["s2"]);
    expect(result.recent.map((s) => s.id)).toEqual(["s3"]);
  });
});
```

The overdue test encodes v0.2's decision: close is explicit, and `ends_at` passing changes nothing.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w web -- memberSessions`
Expected: FAIL — cannot resolve `@/lib/memberSessions`.

- [ ] **Step 3: Implement the shaping module**

`packages/web/src/lib/memberSessions.ts`:

```ts
import { deriveCycleStatus, isCycleOverdue, type CycleDetail, type CycleStatus } from "core";

export interface MemberSessionJson {
  id: string;
  groupId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: CycleStatus;
  isOverdue: boolean;
  itemTypeKeys: string[];
  participantIds: string[];
}

export function toMemberSessionJson(cycle: CycleDetail, now = new Date()): MemberSessionJson {
  return {
    id: cycle.id,
    groupId: cycle.cohortId,
    name: cycle.name,
    startsAt: cycle.startsAt.toISOString(),
    endsAt: cycle.endsAt.toISOString(),
    status: deriveCycleStatus(cycle, now),
    isOverdue: isCycleOverdue(cycle, now),
    itemTypeKeys: cycle.itemTypeKeys,
    participantIds: cycle.participantIds,
  };
}

export function splitByStatus(cycles: CycleDetail[], now = new Date()) {
  const live: MemberSessionJson[] = [];
  const scheduled: MemberSessionJson[] = [];
  const recent: MemberSessionJson[] = [];
  for (const cycle of cycles) {
    const json = toMemberSessionJson(cycle, now);
    if (json.status === "live") live.push(json);
    else if (json.status === "scheduled") scheduled.push(json);
    else recent.push(json);
  }
  return { live, scheduled, recent };
}
```

- [ ] **Step 4: Implement the routes**

`packages/web/src/app/api/sessions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { cycleStore } from "@/lib/db";
import { splitByStatus } from "@/lib/memberSessions";

export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const cycles = await cycleStore.listCyclesForParticipant(current.clerkUserId);
  return NextResponse.json(splitByStatus(cycles));
}
```

`packages/web/src/app/api/current-session/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/lib/auth";
import { currentCycleStore, cycleStore } from "@/lib/db";
import { toMemberSessionJson } from "@/lib/memberSessions";

export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const cycle = await currentCycleStore.getCurrentCycle(current.clerkUserId);
  // A stale pointer resolves to null, never an error — the client renders the chooser.
  return NextResponse.json({ session: cycle ? toMemberSessionJson(cycle) : null });
}

export async function PUT(request: Request) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = (body as { sessionId?: unknown }).sessionId;
  if (sessionId === null) {
    await currentCycleStore.clearCurrentCycle(current.clerkUserId);
    return NextResponse.json({ session: null });
  }
  if (typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId must be a string or null" }, { status: 400 });
  }

  if (!(await cycleStore.isCycleParticipant(sessionId, current.clerkUserId))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  await currentCycleStore.setCurrentCycle(current.clerkUserId, sessionId);
  const cycle = await currentCycleStore.getCurrentCycle(current.clerkUserId);
  return NextResponse.json({ session: cycle ? toMemberSessionJson(cycle) : null });
}
```

- [ ] **Step 5: Write route tests**

`packages/web/tests/integration/member-api/sessions.test.ts`, mocking `@/lib/db` and `@/lib/auth`
exactly as `group-sessions.test.ts` does. Cover: unauthenticated `401` on both routes; `GET /api/sessions`
returns only the caller's cycles split three ways; `PUT` with a non-participant session id returns
`403`; `PUT` with `null` clears; a stale pointer makes `GET /api/current-session` return
`{ session: null }` with status `200`.

- [ ] **Step 6: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- memberSessions sessions
git add packages/web/src/lib packages/web/src/app/api packages/web/tests
git commit -m "feat(web): member sessions list and current-session toggle

Closes #59"
```

---

## Task 6: Web — ledger read API (snapshot and delta)

**GitHub issue:** [#60](https://github.com/pete-the-pete/mangoes/issues/60) · **Blocked by:** #55, #56, #58

The two read paths the whole client sync layer is built on.

**Files:**
- Create: `packages/web/src/app/api/sessions/[sessionId]/snapshot/route.ts`
- Create: `packages/web/src/app/api/sessions/[sessionId]/entries/route.ts`
- Create: `packages/web/src/lib/ledgerJson.ts`
- Create: `packages/web/tests/integration/member-api/ledger-read.test.ts`

**Interfaces:**
- Consumes: `requireCycleParticipant`, `ledgerStore.snapshot`, `ledgerStore.readSince`, `cycleStore.getCycle`.
- Produces: `toEntryJson(entry)`, `DELTA_PAGE_SIZE`, and both routes.

---

- [ ] **Step 1: Implement the JSON shaper**

`packages/web/src/lib/ledgerJson.ts`:

```ts
import type { LedgerEntry } from "core";

export const DELTA_PAGE_SIZE = 500;

export interface EntryJson {
  id: string;
  seq: number;
  kind: "log" | "void";
  itemTypeKey: string;
  subjectUserId: string | null;
  actorUserId: string;
  clientEntryId: string;
  occurredAt: string;
}

export function toEntryJson(entry: LedgerEntry): EntryJson {
  return {
    id: entry.id,
    seq: entry.seq,
    kind: entry.kind,
    itemTypeKey: entry.itemTypeKey,
    subjectUserId: entry.subjectUserId,
    actorUserId: entry.actorUserId,
    clientEntryId: entry.clientEntryId,
    occurredAt: entry.occurredAt.toISOString(),
  };
}
```

- [ ] **Step 2: Implement the snapshot route**

```ts
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { cycleStore, ledgerStore, itemTypeStore } from "@/lib/db";
import { toMemberSessionJson } from "@/lib/memberSessions";

interface RouteContext { params: Promise<{ sessionId: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cycle = await cycleStore.getCycle(sessionId);
  if (!cycle) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const [aggregate, catalog, clerk] = await Promise.all([
    ledgerStore.snapshot(sessionId),
    itemTypeStore.listItemTypes({ enabledOnly: false }),
    clerkClient(),
  ]);

  // Identity is joined server-side, the way adminUsers.ts already does it — the
  // client never gets a Clerk key and never makes a Clerk call.
  const users = await clerk.users.getUserList({ userId: cycle.participantIds, limit: 100 });
  const participants = users.data.map((u) => ({
    clerkUserId: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.primaryEmailAddress?.emailAddress || u.id,
    imageUrl: u.imageUrl,
  }));

  const itemTypes = cycle.itemTypeKeys
    .map((key) => catalog.find((t) => t.key === key))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ key: t.key, emoji: t.emoji, label: t.label }));

  return NextResponse.json({
    session: toMemberSessionJson(cycle),
    cursor: aggregate.cursor,
    counts: aggregate.counts,
    itemTypes,
    participants,
  });
}
```

Item types come from the cycle's own `itemTypeKeys`, not from the enabled catalog — v0.2 decided
disabling an entry is picker-only, so a session already tracking a disabled item keeps rendering it.

- [ ] **Step 3: Implement the delta route**

```ts
export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  if (!Number.isInteger(after) || after < 0) {
    return NextResponse.json({ error: "after must be a non-negative integer" }, { status: 400 });
  }

  const page = await ledgerStore.readSince(sessionId, after, DELTA_PAGE_SIZE);
  return NextResponse.json({
    entries: page.entries.map(toEntryJson),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
}
```

- [ ] **Step 4: Write route tests**

Cover: non-participant `403` on both; snapshot returns cursor, counts, item types in the cycle's
order, and joined participants; delta with `after=0` returns everything; delta paging sets `hasMore`
true then false; a non-numeric `after` returns `400`.

- [ ] **Step 5: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- ledger-read
git add packages/web/src/lib/ledgerJson.ts packages/web/src/app/api packages/web/tests
git commit -m "feat(web): ledger snapshot and delta endpoints

Closes #60"
```

---

## Task 7: Web — ledger write API (batch outbox flush)

**GitHub issue:** [#61](https://github.com/pete-the-pete/mangoes/issues/61) · **Blocked by:** #55, #58

The endpoint the offline outbox flushes into. One request carries a whole queue.

**Files:**
- Create: `packages/web/src/app/api/sessions/[sessionId]/entries/route.ts` (adds `POST` to Task 6's file)
- Create: `packages/web/src/lib/appendOps.ts`
- Create: `packages/web/tests/unit/lib/appendOps.test.ts`
- Modify: `packages/web/tests/integration/member-api/ledger-read.test.ts` → add write cases, or add
  `ledger-write.test.ts`

**Interfaces:**
- Consumes: `requireCycleParticipant`, `ledgerStore.append`, `AppendOp`, `RejectReason`.
- Produces: `parseAppendOps(body)`, `rejectionMessage(reason)`.

---

- [ ] **Step 1: Write the failing parser tests**

`packages/web/tests/unit/lib/appendOps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAppendOps, rejectionMessage } from "@/lib/appendOps";

const uuid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("parseAppendOps", () => {
  it("accepts a log op", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: uuid, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a void op referencing a client id", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: uuid, kind: "void", voidsClientEntryId: other, occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a log with no item type", () => {
    const result = parseAppendOps({ ops: [{ clientEntryId: uuid, kind: "log", occurredAt: "2026-09-01T00:00:00.000Z" }] });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects a non-uuid client entry id", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: "nope", kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects an empty batch and one over the cap", () => {
    expect(parseAppendOps({ ops: [] })).toMatchObject({ ok: false });
    const many = Array.from({ length: 501 }, () => ({
      clientEntryId: uuid, kind: "log", itemTypeKey: "mango", occurredAt: "2026-09-01T00:00:00.000Z",
    }));
    expect(parseAppendOps({ ops: many })).toMatchObject({ ok: false });
  });

  it("never lets a member set subjectUserId", () => {
    const result = parseAppendOps({
      ops: [{ clientEntryId: uuid, kind: "log", itemTypeKey: "mango", subjectUserId: "someone-else", occurredAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("rejectionMessage", () => {
  it("translates the core reason into session vocabulary", () => {
    expect(rejectionMessage("cycle_closed")).toBe("Only a session admin can amend a closed session");
  });
});
```

The `subjectUserId` test matters: members never log for anyone else, and the parser is the place to
say so — `AppendContext.canWriteForOthers` is the backstop, not the primary check.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w web -- appendOps`
Expected: FAIL — cannot resolve `@/lib/appendOps`.

- [ ] **Step 3: Implement the parser**

```ts
import type { AppendOp, RejectReason } from "core";

export const MAX_BATCH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseAppendOps(body: unknown): ParseResult<AppendOp[]> {
  const ops = (body as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) return { ok: false, error: "ops must be an array" };
  if (ops.length === 0) return { ok: false, error: "ops must not be empty" };
  if (ops.length > MAX_BATCH) return { ok: false, error: `ops must contain at most ${MAX_BATCH} entries` };

  const parsed: AppendOp[] = [];
  for (const raw of ops as Record<string, unknown>[]) {
    const clientEntryId = raw["clientEntryId"];
    if (typeof clientEntryId !== "string" || !UUID.test(clientEntryId)) {
      return { ok: false, error: "clientEntryId must be a UUID" };
    }
    // Members never log for anyone else. canWriteForOthers is the backstop.
    if ("subjectUserId" in raw) {
      return { ok: false, error: "subjectUserId is not accepted on this endpoint" };
    }
    const occurredAtRaw = raw["occurredAt"];
    if (typeof occurredAtRaw !== "string" || Number.isNaN(Date.parse(occurredAtRaw))) {
      return { ok: false, error: "occurredAt must be an ISO timestamp" };
    }
    const occurredAt = new Date(occurredAtRaw);
    const kind = raw["kind"];

    if (kind === "log") {
      const itemTypeKey = raw["itemTypeKey"];
      if (typeof itemTypeKey !== "string" || itemTypeKey.length === 0) {
        return { ok: false, error: "itemTypeKey is required for a log op" };
      }
      parsed.push({ clientEntryId, kind: "log", itemTypeKey, occurredAt });
    } else if (kind === "void") {
      const voidsClientEntryId = raw["voidsClientEntryId"];
      if (typeof voidsClientEntryId !== "string" || !UUID.test(voidsClientEntryId)) {
        return { ok: false, error: "voidsClientEntryId must be a UUID" };
      }
      parsed.push({ clientEntryId, kind: "void", voidsClientEntryId, occurredAt });
    } else {
      return { ok: false, error: 'kind must be "log" or "void"' };
    }
  }
  return { ok: true, value: parsed };
}

/** Core speaks Cycle; the member-facing copy says Session. */
export function rejectionMessage(reason: RejectReason): string {
  switch (reason) {
    case "cycle_closed": return "Only a session admin can amend a closed session";
    case "unknown_target": return "That log no longer exists";
    case "not_your_entry": return "You can only change your own logs";
    case "already_voided": return "That log was already removed";
    case "unknown_item_type": return "That item is not tracked in this session";
    case "malformed_op": return "That log could not be read";
  }
}
```

- [ ] **Step 4: Add `POST` to the entries route**

```ts
export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseAppendOps(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Member policy. Admin writes go through the /admin namespace with a different context.
  const result = await ledgerStore.append(
    sessionId,
    {
      actorUserId: guard.clerkUserId,
      canVoidOthers: false,
      canWriteClosed: false,
      canWriteForOthers: false,
    },
    parsed.value,
  );

  return NextResponse.json({
    cursor: result.cursor,
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected.map((r) => ({
      clientEntryId: r.clientEntryId,
      reason: r.reason,
      message: rejectionMessage(r.reason),
    })),
  });
}
```

Note the response is always `200` even when some ops are rejected. A partial rejection is data, not a
transport failure, and the client needs the `accepted`/`duplicates` lists in the same round trip to
clear its outbox correctly.

- [ ] **Step 5: Write route tests**

Cover: non-participant `403`; a two-op batch where the first is accepted and the second rejected
returns both lists; posting the same `clientEntryId` twice reports it in `duplicates` on the second
call and does not change `cursor`; a member void of someone else's entry is rejected with
`not_your_entry`; a write to a closed session is rejected with `cycle_closed`; a body with
`subjectUserId` returns `400`.

- [ ] **Step 6: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- appendOps ledger
git add packages/web/src/lib/appendOps.ts packages/web/src/app/api packages/web/tests
git commit -m "feat(web): batch ledger append endpoint

Closes #61"
```

---

## Task 8: Web — SSE delta stream

**GitHub issue:** [#62](https://github.com/pete-the-pete/mangoes/issues/62) · **Blocked by:** #60

Liveness only. Correctness never depends on this endpoint — a client that never connects still
converges through polling, because the cursor is authoritative either way.

**Files:**
- Create: `packages/web/src/app/api/sessions/[sessionId]/stream/route.ts`

**Interfaces:**
- Consumes: `requireCycleParticipant`, `ledgerStore.readSince`, `toEntryJson`, `DELTA_PAGE_SIZE`.
- Produces: an SSE endpoint emitting the same payload shape as `GET /entries`.

---

- [ ] **Step 1: Implement the stream**

```ts
import { requireCycleParticipant } from "@/lib/cycleAuth";
import { ledgerStore } from "@/lib/db";
import { toEntryJson, DELTA_PAGE_SIZE } from "@/lib/ledgerJson";

export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ sessionId: string }> }

const POLL_MS = 2000;
const MAX_LIFETIME_MS = 5 * 60 * 1000;

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const guard = await requireCycleParticipant(sessionId);
  if (!guard.ok) {
    return new Response(JSON.stringify({ error: guard.error }), {
      status: guard.status,
      headers: { "content-type": "application/json" },
    });
  }

  let cursor = Number(new URL(request.url).searchParams.get("after") ?? "0");
  if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      let closed = false;

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed by the client */ }
      };

      request.signal.addEventListener("abort", finish);

      // Deliberately a short poll against Postgres rather than LISTEN/NOTIFY: a
      // dedicated LISTEN connection per subscriber does not survive a serverless
      // deployment or a connection pooler, and this endpoint is a liveness
      // enhancement, not the correctness path.
      const timer = setInterval(async () => {
        if (closed) return;
        if (Date.now() - started > MAX_LIFETIME_MS) {
          // EventSource reconnects on its own; capping lifetime keeps a stuck
          // function from living forever.
          finish();
          return;
        }
        try {
          const page = await ledgerStore.readSince(sessionId, cursor, DELTA_PAGE_SIZE);
          if (page.entries.length > 0) {
            cursor = page.nextCursor;
            const payload = JSON.stringify({
              entries: page.entries.map(toEntryJson),
              nextCursor: page.nextCursor,
              hasMore: page.hasMore,
            });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } else {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }
        } catch {
          finish();
        }
      }, POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify manually**

```bash
npm run dev -w web
# In another shell, signed in via a browser cookie is easier — but the shape check:
curl -N http://localhost:3000/api/sessions/<id>/stream
```

Expected: a `: keepalive` comment every two seconds, and a `data: {...}` frame within two seconds of
logging an entry from the UI or via `POST /entries`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/sessions
git commit -m "feat(web): SSE delta stream for live sessions

Closes #62"
```

---

## Task 9: Web — admin on-behalf, untagged, and void routes

**GitHub issue:** [#63](https://github.com/pete-the-pete/mangoes/issues/63) · **Blocked by:** #55

Untagged and on-behalf logging are administrative acts, so they extend v0.2's admin namespace rather
than the member one. This is also what gives `subject_user_id = null` its only producer — without
this task the column ships with nothing able to write to it.

**Files:**
- Create: `packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/entries/route.ts`
- Create: `packages/web/src/app/admin/api/groups/[groupId]/sessions/[sessionId]/entries/[entryId]/void/route.ts`
- Create: `packages/web/tests/integration/admin-api/session-entries.test.ts`

**Interfaces:**
- Consumes: `requireCohortRole` (v0.2), `ledgerStore.append`, `cycleStore.getCycle`.

---

- [ ] **Step 1: Implement the admin append route**

```ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCohortRole } from "@/lib/cohortAuth";
import { cycleStore, ledgerStore } from "@/lib/db";
import { rejectionMessage } from "@/lib/appendOps";

interface RouteContext { params: Promise<{ groupId: string; sessionId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const { groupId, sessionId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const cycle = await cycleStore.getCycle(sessionId);
  // A session that does not belong to the named group is a plain 404, so the two
  // cases are not distinguishable by probing — v0.2's rule, kept.
  if (!cycle || cycle.cohortId !== groupId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { itemTypeKey, subjectUserId } = body as {
    itemTypeKey?: unknown; subjectUserId?: unknown;
  };
  if (typeof itemTypeKey !== "string" || !cycle.itemTypeKeys.includes(itemTypeKey)) {
    return NextResponse.json({ error: "That item is not tracked in this session" }, { status: 400 });
  }
  // null is meaningful — it is the untagged, "for the group" case.
  if (subjectUserId !== null && typeof subjectUserId !== "string") {
    return NextResponse.json({ error: "subjectUserId must be a user id or null" }, { status: 400 });
  }
  if (typeof subjectUserId === "string" && !cycle.participantIds.includes(subjectUserId)) {
    return NextResponse.json({ error: "That person is not in this session" }, { status: 400 });
  }

  const result = await ledgerStore.append(
    sessionId,
    {
      actorUserId: guard.clerkUserId,
      canVoidOthers: true,
      canWriteClosed: true,     // vision Must Have: admins amend closed sessions
      canWriteForOthers: true,
    },
    [{ clientEntryId: randomUUID(), kind: "log", itemTypeKey, subjectUserId, occurredAt: new Date() }],
  );

  const rejection = result.rejected[0];
  if (rejection) {
    return NextResponse.json({ error: rejectionMessage(rejection.reason) }, { status: 400 });
  }
  return NextResponse.json({ cursor: result.cursor }, { status: 201 });
}
```

- [ ] **Step 2: Implement the admin void route**

Same guard and same 404 rule. It resolves the target by **server** id (an admin is clicking a row in a
list the server rendered, so no client id exists), then appends a void with `canVoidOthers: true` and
`canWriteClosed: true`.

```ts
export async function POST(_request: Request, context: EntryContext) {
  const { groupId, sessionId, entryId } = await context.params;
  const guard = await requireCohortRole(groupId, ["admin"]);
  if (!guard.ok || !guard.clerkUserId) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const cycle = await cycleStore.getCycle(sessionId);
  if (!cycle || cycle.cohortId !== groupId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const target = await ledgerStore.getEntryById(sessionId, entryId);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await ledgerStore.append(
    sessionId,
    { actorUserId: guard.clerkUserId, canVoidOthers: true, canWriteClosed: true, canWriteForOthers: true },
    [{ clientEntryId: randomUUID(), kind: "void", voidsClientEntryId: target.clientEntryId, occurredAt: new Date() }],
  );

  const rejection = result.rejected[0];
  if (rejection) {
    return NextResponse.json({ error: rejectionMessage(rejection.reason) }, { status: 400 });
  }
  return NextResponse.json({ cursor: result.cursor });
}
```

`ledgerStore.getEntryById` is defined in Task 1 — it resolves by **server** id, unlike the member
path's client-id lookup, because an admin is clicking a row the server rendered and has no client id.

- [ ] **Step 3: Write route tests**

Cover: non-admin `403`; a session in a different group `404`; untagged write stores `subjectUserId:
null`; on-behalf write passes a distinct actor and subject; a write to a closed session succeeds
(unlike a member's); an item type not tracked by the session returns `400`; a subject not in the
session returns `400`.

- [ ] **Step 4: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- session-entries
git add packages/web/src/app/admin/api packages/core/src/ledger packages/web/tests
git commit -m "feat(web): admin on-behalf, untagged, and void logging

Closes #63"
```

---

## Task 10: Web — IndexedDB sync store and outbox

**GitHub issue:** [#64](https://github.com/pete-the-pete/mangoes/issues/64) · **Blocked by:** #56

Local durability for taps made with no signal. This is the task where the two undo cases live, and
they are the part an implementer gets wrong if they are left implicit.

**Files:**
- Create: `packages/web/src/lib/sync/store.ts`
- Create: `packages/web/tests/unit/lib/sync/store.test.ts`
- Modify: `packages/web/package.json` — add `idb` (dependency) and `fake-indexeddb` (devDependency)

**Interfaces:**
- Consumes: `Aggregate`, `LedgerEntry`, `emptyAggregate` from core.
- Produces: `openSyncStore()`, `SyncStore` with `readAggregate`, `writeAggregate`, `enqueueLog`,
  `enqueueVoid`, `undo`, `readOutbox`, `settleFlush`, `readMyEntries`, `LocalEntry`, `EntryState`.

---

- [ ] **Step 1: Add the dependencies**

```bash
npm install idb -w web
npm install -D fake-indexeddb -w web
```

- [ ] **Step 2: Write the failing tests**

`packages/web/tests/unit/lib/sync/store.test.ts`:

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openSyncStore } from "@/lib/sync/store";

const SESSION = "s1";
let store: Awaited<ReturnType<typeof openSyncStore>>;

beforeEach(async () => {
  store = await openSyncStore();
  await store.clearSession(SESSION);
});

describe("outbox", () => {
  it("starts empty with an empty aggregate", async () => {
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readAggregate(SESSION)).toEqual({ cursor: 0, counts: {} });
  });

  it("enqueues a log as pending and records it in myEntries", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    expect(entry.state).toBe("pending");
    expect(await store.readOutbox(SESSION)).toHaveLength(1);
    expect(await store.readMyEntries(SESSION)).toHaveLength(1);
  });

  // Undo case 1: nothing ever reaches the server.
  it("undo on a pending entry removes it from the outbox and leaves no tombstone", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.undo(SESSION, entry.clientEntryId);

    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  // Undo case 2: a real append that propagates to everyone.
  it("undo on a synced entry enqueues a void and marks the entry voiding", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);

    const outbox = await store.readOutbox(SESSION);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.kind).toBe("void");
    expect(outbox[0]!.voidsClientEntryId).toBe(entry.clientEntryId);

    const mine = await store.readMyEntries(SESSION);
    expect(mine[0]!.state).toBe("voiding");
  });

  it("copies the target's item and subject onto a void op, for immediate display", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, { accepted: [entry.clientEntryId], duplicates: [], rejected: [], cursor: 1 });
    await store.undo(SESSION, entry.clientEntryId);

    const [op] = await store.readOutbox(SESSION);
    expect(op!.itemTypeKey).toBe("mango");
    expect(op!.subjectUserId).toBe("u1");
  });

  it("clears accepted and duplicate ops from the outbox on settle", async () => {
    const a = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const b = await store.enqueueLog(SESSION, { itemTypeKey: "taco", subjectUserId: "u1" });
    await store.settleFlush(SESSION, {
      accepted: [a.clientEntryId], duplicates: [b.clientEntryId], rejected: [], cursor: 2,
    });
    expect(await store.readOutbox(SESSION)).toEqual([]);
    for (const entry of await store.readMyEntries(SESSION)) {
      expect(entry.state).toBe("synced");
    }
  });

  it("drops a rejected op rather than retrying it forever", async () => {
    const entry = await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    await store.settleFlush(SESSION, {
      accepted: [], duplicates: [],
      rejected: [{ clientEntryId: entry.clientEntryId, reason: "cycle_closed", message: "closed" }],
      cursor: 0,
    });
    expect(await store.readOutbox(SESSION)).toEqual([]);
    expect(await store.readMyEntries(SESSION)).toEqual([]);
  });

  it("survives a reopen — the outbox is durable, not in memory", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    const reopened = await openSyncStore();
    expect(await reopened.readOutbox(SESSION)).toHaveLength(1);
  });

  it("keeps sessions isolated", async () => {
    await store.enqueueLog(SESSION, { itemTypeKey: "mango", subjectUserId: "u1" });
    expect(await store.readOutbox("s2")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test -w web -- sync/store`
Expected: FAIL — cannot resolve `@/lib/sync/store`.

- [ ] **Step 4: Implement the store**

`packages/web/src/lib/sync/store.ts`:

```ts
import { openDB, type IDBPDatabase } from "idb";
import { emptyAggregate, type Aggregate } from "core";

const DB_NAME = "mango-sync";
const DB_VERSION = 1;

export type EntryState = "pending" | "synced" | "voiding";

export interface LocalEntry {
  clientEntryId: string;
  sessionId: string;
  itemTypeKey: string;
  subjectUserId: string;
  occurredAt: string;
  state: EntryState;
}

export interface OutboxOp {
  clientEntryId: string;
  sessionId: string;
  kind: "log" | "void";
  /**
   * Present on BOTH kinds. On a void it is copied from the local target so the UI
   * can render the decrement immediately, offline, without a lookup. The server
   * ignores it on a void and re-derives from the target row — this copy is a
   * display aid, never a source of truth.
   */
  itemTypeKey?: string;
  subjectUserId?: string;
  voidsClientEntryId?: string;
  occurredAt: string;
}

export interface FlushOutcome {
  cursor: number;
  accepted: string[];
  duplicates: string[];
  rejected: { clientEntryId: string; reason: string; message: string }[];
}

async function open(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Keyed by sessionId so one member in several sessions keeps them separate.
      db.createObjectStore("aggregates");
      const outbox = db.createObjectStore("outbox", { keyPath: "clientEntryId" });
      outbox.createIndex("bySession", "sessionId");
      const mine = db.createObjectStore("myEntries", { keyPath: "clientEntryId" });
      mine.createIndex("bySession", "sessionId");
    },
  });
}

export async function openSyncStore() {
  const db = await open();

  return {
    async readAggregate(sessionId: string): Promise<Aggregate> {
      return (await db.get("aggregates", sessionId)) ?? emptyAggregate();
    },

    async writeAggregate(sessionId: string, aggregate: Aggregate): Promise<void> {
      await db.put("aggregates", aggregate, sessionId);
    },

    async readOutbox(sessionId: string): Promise<OutboxOp[]> {
      const ops: OutboxOp[] = await db.getAllFromIndex("outbox", "bySession", sessionId);
      // Order matters: a batch containing an entry and its void must arrive that way.
      return ops.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    },

    async readMyEntries(sessionId: string): Promise<LocalEntry[]> {
      const entries: LocalEntry[] = await db.getAllFromIndex("myEntries", "bySession", sessionId);
      return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },

    async enqueueLog(
      sessionId: string,
      input: { itemTypeKey: string; subjectUserId: string },
    ): Promise<LocalEntry> {
      const clientEntryId = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const entry: LocalEntry = { clientEntryId, sessionId, ...input, occurredAt, state: "pending" };
      const tx = db.transaction(["outbox", "myEntries"], "readwrite");
      await tx.objectStore("outbox").put({
        clientEntryId, sessionId, kind: "log", itemTypeKey: input.itemTypeKey, occurredAt,
      });
      await tx.objectStore("myEntries").put(entry);
      await tx.done;
      return entry;
    },

    /**
     * Undo is two cases, and the second is where bugs live.
     *
     *  - target still pending: drop it from the outbox. No tombstone ever reaches
     *    the server, because the server never heard about it.
     *  - target already synced: enqueue a void. That is a real append — it takes a
     *    sequence and propagates to every other client.
     */
    async undo(sessionId: string, clientEntryId: string): Promise<void> {
      const tx = db.transaction(["outbox", "myEntries"], "readwrite");
      const outbox = tx.objectStore("outbox");
      const mine = tx.objectStore("myEntries");

      const pending = await outbox.get(clientEntryId);
      if (pending) {
        await outbox.delete(clientEntryId);
        await mine.delete(clientEntryId);
        await tx.done;
        return;
      }

      const entry: LocalEntry | undefined = await mine.get(clientEntryId);
      if (!entry) {
        await tx.done;
        return;
      }
      await outbox.put({
        clientEntryId: crypto.randomUUID(),
        sessionId,
        kind: "void",
        voidsClientEntryId: clientEntryId,
        // Copied so the UI can decrement now rather than when the void syncs.
        itemTypeKey: entry.itemTypeKey,
        subjectUserId: entry.subjectUserId,
        occurredAt: new Date().toISOString(),
      });
      await mine.put({ ...entry, state: "voiding" });
      await tx.done;
    },

    async enqueueVoid(sessionId: string, voidsClientEntryId: string): Promise<void> {
      await this.undo(sessionId, voidsClientEntryId);
    },

    /** Clears settled ops. Rejected ops are dropped, never retried forever. */
    async settleFlush(sessionId: string, outcome: FlushOutcome): Promise<void> {
      const tx = db.transaction(["outbox", "myEntries"], "readwrite");
      const outbox = tx.objectStore("outbox");
      const mine = tx.objectStore("myEntries");

      for (const id of [...outcome.accepted, ...outcome.duplicates]) {
        await outbox.delete(id);
        const entry: LocalEntry | undefined = await mine.get(id);
        if (entry && entry.state === "pending") {
          await mine.put({ ...entry, state: "synced" });
        }
      }
      for (const rejection of outcome.rejected) {
        await outbox.delete(rejection.clientEntryId);
        await mine.delete(rejection.clientEntryId);
      }
      await tx.done;
    },

    async clearSession(sessionId: string): Promise<void> {
      const tx = db.transaction(["aggregates", "outbox", "myEntries"], "readwrite");
      await tx.objectStore("aggregates").delete(sessionId);
      for (const name of ["outbox", "myEntries"] as const) {
        const idStore = tx.objectStore(name);
        const keys = await idStore.index("bySession").getAllKeys(sessionId);
        for (const key of keys) await idStore.delete(key);
      }
      await tx.done;
    },
  };
}

export type SyncStore = Awaited<ReturnType<typeof openSyncStore>>;

/**
 * IndexedDB is unavailable in some private-browsing modes and under quota
 * pressure. Callers use this to fall back to online-only logging with a visible
 * banner, rather than failing taps silently.
 */
export async function openSyncStoreOrNull(): Promise<SyncStore | null> {
  try {
    return await openSyncStore();
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- sync/store
git add packages/web/src/lib/sync packages/web/tests packages/web/package.json package-lock.json
git commit -m "feat(web): IndexedDB sync store with a durable outbox

Closes #64"
```

---

## Task 11: Web — sync client orchestration and transport selection

**GitHub issue:** [#65](https://github.com/pete-the-pete/mangoes/issues/65) · **Blocked by:** #60, #61, #62, #64

**Files:**
- Create: `packages/web/src/lib/sync/transport.ts`
- Create: `packages/web/src/lib/sync/client.ts`
- Create: `packages/web/src/lib/sync/useSession.ts` (React hook wrapper)
- Create: `packages/web/tests/unit/lib/sync/transport.test.ts`

**Interfaces:**
- Consumes: `openSyncStoreOrNull`, `foldEntries`, `emptyAggregate`, the four API routes.
- Produces: `pickTransport(connection)`, `createSyncClient(sessionId)`, `useSession(sessionId)`.

---

- [ ] **Step 1: Write the failing transport tests**

Transport selection is pure and therefore the one piece of the client worth unit testing directly.

```ts
import { describe, it, expect } from "vitest";
import { pickTransport } from "@/lib/sync/transport";

describe("pickTransport", () => {
  it("uses SSE on wifi", () => {
    expect(pickTransport({ type: "wifi" })).toBe("sse");
  });

  it("polls on cellular", () => {
    expect(pickTransport({ type: "cellular" })).toBe("poll");
  });

  // The vision's iOS Safari caveat: mis-detection must cost liveness, never data.
  it("polls when the connection type is unknown", () => {
    expect(pickTransport({ type: "unknown" })).toBe("poll");
  });

  it("polls when the Network Information API is absent entirely", () => {
    expect(pickTransport(undefined)).toBe("poll");
  });

  it("treats ethernet like wifi", () => {
    expect(pickTransport({ type: "ethernet" })).toBe("sse");
  });
});
```

- [ ] **Step 2: Implement transport selection**

```ts
export type Transport = "sse" | "poll";

interface ConnectionLike { type?: string | undefined }

/**
 * Unknown counts as cellular. Connection type is unreliable on iOS Safari, and
 * the conservative default only costs liveness — the cursor/fold path is identical
 * either way, so a mis-detection never costs correctness.
 */
export function pickTransport(connection: ConnectionLike | undefined): Transport {
  const type = connection?.type;
  return type === "wifi" || type === "ethernet" ? "sse" : "poll";
}

export function currentConnection(): ConnectionLike | undefined {
  return (navigator as unknown as { connection?: ConnectionLike }).connection;
}
```

- [ ] **Step 3: Implement the sync client**

`packages/web/src/lib/sync/client.ts`. The rules it must obey:

- **Cold open:** `GET /snapshot` when there is no local aggregate, `GET /entries?after=cursor` when
  there is.
- **Displayed totals are computed at render** as `foldEntries(counts, outboxAsEntries)` — never
  written into the stored aggregate. Pending taps show instantly and cannot double-count: when the
  server's own copy arrives in the delta stream, `settleFlush` drops the outbox op in the same step.
- **Sync and flush triggers are the same set:** the `online` event, `visibilitychange` → visible, and
  a periodic tick while the page is open.
- **No Background Sync API.** Chromium-only; the target device is a friend's iPhone. Progressive
  enhancement only, where it exists.

```ts
import { emptyAggregate, foldEntries, type Aggregate, type LedgerEntry } from "core";
import { openSyncStoreOrNull, type OutboxOp, type SyncStore } from "./store";
import { currentConnection, pickTransport } from "./transport";

const POLL_INTERVAL_MS = 15_000;

export interface SyncState {
  aggregate: Aggregate;      // stored counts, server-confirmed
  pending: OutboxOp[];       // not yet accepted
  degraded: boolean;         // IndexedDB unavailable — online-only, show a banner
  online: boolean;
}

/**
 * What the UI renders: confirmed counts plus this device's unsent ops.
 *
 * BOTH kinds are folded. Skipping pending voids would mean an undo made offline
 * leaves the count untouched until it syncs — the user taps Undo and nothing
 * happens, which reads as a broken button.
 */
export function displayedAggregate(state: SyncState, subjectUserId: string): Aggregate {
  const asEntries: LedgerEntry[] = state.pending.map((op, index) => ({
    id: op.clientEntryId,
    cycleId: op.sessionId,
    // Above the stored cursor so foldEntries does not skip them. These synthetic
    // sequences never reach the server and are recomputed on every render.
    seq: state.aggregate.cursor + index + 1,
    kind: op.kind,
    itemTypeKey: op.itemTypeKey!,
    subjectUserId: op.subjectUserId ?? subjectUserId,
    actorUserId: subjectUserId,
    voidsEntryId: null,
    clientEntryId: op.clientEntryId,
    occurredAt: new Date(op.occurredAt),
    createdAt: new Date(op.occurredAt),
  }));
  // Fold into a copy whose cursor stays put, so the next real delta still applies.
  const folded = foldEntries(state.aggregate, asEntries);
  return { cursor: state.aggregate.cursor, counts: folded.counts };
}

export function createSyncClient(sessionId: string, onChange: (state: SyncState) => void) {
  let store: SyncStore | null = null;
  let state: SyncState = {
    aggregate: emptyAggregate(), pending: [], degraded: false, online: true,
  };
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = () => onChange({ ...state });

  async function refreshPending() {
    state.pending = store ? await store.readOutbox(sessionId) : [];
  }

  async function pullDelta() {
    const response = await fetch(`/api/sessions/${sessionId}/entries?after=${state.aggregate.cursor}`);
    if (!response.ok) return;
    const body = await response.json();
    const entries: LedgerEntry[] = body.entries.map(reviveEntry);
    state.aggregate = foldEntries(state.aggregate, entries);
    await store?.writeAggregate(sessionId, state.aggregate);
    emit();
  }

  async function coldOpen() {
    const response = await fetch(`/api/sessions/${sessionId}/snapshot`);
    if (!response.ok) return;
    const body = await response.json();
    state.aggregate = { cursor: body.cursor, counts: body.counts };
    await store?.writeAggregate(sessionId, state.aggregate);
    emit();
  }

  async function flush() {
    if (!store || !navigator.onLine) return;
    const ops = await store.readOutbox(sessionId);
    if (ops.length === 0) return;

    const response = await fetch(`/api/sessions/${sessionId}/entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: ops.map(toWireOp) }),
    });
    if (!response.ok) return;  // stay queued; the next trigger retries

    const outcome = await response.json();
    await store.settleFlush(sessionId, outcome);
    await refreshPending();
    await pullDelta();
    emit();
  }

  async function sync() {
    if (!navigator.onLine) return;
    if (state.aggregate.cursor === 0) await coldOpen();
    else await pullDelta();
    await flush();
  }

  function openStream() {
    if (pickTransport(currentConnection()) !== "sse") return;
    source = new EventSource(`/api/sessions/${sessionId}/stream?after=${state.aggregate.cursor}`);
    source.onmessage = async (event) => {
      const body = JSON.parse(event.data);
      state.aggregate = foldEntries(state.aggregate, body.entries.map(reviveEntry));
      await store?.writeAggregate(sessionId, state.aggregate);
      emit();
    };
    // EventSource reconnects on its own; polling below is the safety net regardless.
  }

  return {
    async start() {
      store = await openSyncStoreOrNull();
      state.degraded = store === null;
      state.online = navigator.onLine;
      if (store) {
        state.aggregate = await store.readAggregate(sessionId);
        await refreshPending();
      }
      emit();
      await sync();
      openStream();

      const onOnline = () => { state.online = true; emit(); void sync(); };
      const onOffline = () => { state.online = false; emit(); };
      const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      document.addEventListener("visibilitychange", onVisible);
      timer = setInterval(() => void sync(), POLL_INTERVAL_MS);

      return () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        document.removeEventListener("visibilitychange", onVisible);
        if (timer) clearInterval(timer);
        source?.close();
      };
    },

    async log(itemTypeKey: string, subjectUserId: string) {
      if (!store) return;               // degraded: caller posts directly
      await store.enqueueLog(sessionId, { itemTypeKey, subjectUserId });
      await refreshPending();
      emit();                            // optimistic, before any network call
      void flush();
    },

    async undo(clientEntryId: string) {
      if (!store) return;
      await store.undo(sessionId, clientEntryId);
      await refreshPending();
      emit();
      void flush();
    },
  };
}
```

Write `reviveEntry` (JSON → `LedgerEntry`, parsing `occurredAt`) and `toWireOp` in the same file.

**`toWireOp` must strip `subjectUserId`, and must strip `itemTypeKey` from void ops.** Both are local
display aids. `parseAppendOps` (Task 7) rejects any body carrying `subjectUserId` — members never log
for anyone else — so sending it would turn every flush into a `400`:

```ts
function toWireOp(op: OutboxOp) {
  return op.kind === "log"
    ? { clientEntryId: op.clientEntryId, kind: "log", itemTypeKey: op.itemTypeKey, occurredAt: op.occurredAt }
    : { clientEntryId: op.clientEntryId, kind: "void", voidsClientEntryId: op.voidsClientEntryId, occurredAt: op.occurredAt };
}
```

- [ ] **Step 4: Wrap it in a hook**

`useSession(sessionId)` calls `createSyncClient` in an effect, holds `SyncState` in `useState`, and
returns `{ state, displayed, log, undo }`. Keep it thin — all logic stays in `client.ts`, which is
testable without React.

- [ ] **Step 5: Verify and commit**

```bash
npm run build -w core && npm run test -w web -- sync/transport
npm run build -w web
git add packages/web/src/lib/sync packages/web/tests
git commit -m "feat(web): sync client with offline flush and connection-aware transport

Closes #65"
```

---

## Task 12: Web — PWA manifest and service worker

**GitHub issue:** [#66](https://github.com/pete-the-pete/mangoes/issues/66) · **Blocked by:** #58

**Files:**
- Create: `packages/web/public/manifest.webmanifest`
- Create: `packages/web/public/sw.js`
- Create: `packages/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Create: `packages/web/src/app/RegisterServiceWorker.tsx`
- Modify: `packages/web/src/app/layout.tsx`

---

- [ ] **Step 1: Write the manifest**

```json
{
  "name": "Mango Tracker",
  "short_name": "Mangoes",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Colors are neutral on purpose — v0.4 owns the palette.

- [ ] **Step 2: Write the service worker**

Hand-written, **not `next-pwa`**. The repo is on Next 16 and TypeScript 7, and `npm run lint -w web`
is already broken because typescript-eslint does not support TS 7 (#21). A build-time plugin carrying
its own Next version assumptions is how a second issue like that gets created.

```js
const CACHE = "mango-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // The outbox lives in IndexedDB and the page owns it. The service worker never
  // replays POSTs — that would double-count taps the page has already settled.
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  if (new URL(request.url).pathname.startsWith("/api/")) return; // never cache API reads

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  );
});
```

- [ ] **Step 3: Register it**

`RegisterServiceWorker.tsx` is a `"use client"` component that calls
`navigator.serviceWorker.register("/sw.js")` in an effect, guarded on
`"serviceWorker" in navigator`. Render it from `layout.tsx`, and add
`manifest: "/manifest.webmanifest"` to the exported `metadata`.

- [ ] **Step 4: Verify manually**

```bash
npm run build -w web && npm run start -w web
```

- Chrome DevTools → Application → Manifest shows no errors and offers install.
- Application → Service Workers shows `sw.js` activated.
- Set Network to Offline, reload: the app shell renders rather than the browser's offline page.
- On an iPhone: Share → Add to Home Screen, then launch. It opens standalone, without Safari chrome.

- [ ] **Step 5: Commit**

```bash
git add packages/web/public packages/web/src/app
git commit -m "feat(web): installable PWA with an app-shell service worker

Closes #66"
```

---

## Task 13: Web — member home, session chooser, sessions list

**GitHub issue:** [#67](https://github.com/pete-the-pete/mangoes/issues/67) · **Blocked by:** #59, #65

**Files:**
- Modify: `packages/web/src/app/page.tsx`
- Create: `packages/web/src/app/(member)/sessions/page.tsx`
- Create: `packages/web/src/app/SessionChooser.tsx`
- Create: `packages/web/src/components/SessionCard.tsx`

---

- [ ] **Step 1: Branch `/` on auth state**

`app/page.tsx` stays outside the gated `(member)` group so it is reachable signed out. The product is
invite-only so there is nothing to market, but an abrupt redirect is a worse door than a page.

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { currentCycleStore, cycleStore } from "@/lib/db";
import { splitByStatus } from "@/lib/memberSessions";
import { Splash } from "./Splash";
import { SessionChooser } from "./SessionChooser";

export default async function Home() {
  const { userId } = await auth();
  if (!userId) {
    return <Splash />;   // the existing mango gradient, plus a sign-in button
  }

  const current = await currentCycleStore.getCurrentCycle(userId);
  if (current) {
    redirect(`/sessions/${current.id}`);
  }

  // No valid pointer — stale, cleared, or never set. Not an error, never a toast.
  const cycles = await cycleStore.listCyclesForParticipant(userId);
  return <SessionChooser {...splitByStatus(cycles)} />;
}
```

- [ ] **Step 2: Build `SessionChooser` and `SessionCard`**

`SessionChooser` is a client component listing live sessions first, then scheduled, then recent.
Choosing one `PUT`s `/api/current-session` and navigates to it. `SessionCard` renders name, status
badge, window, and the session's item emoji.

Empty state, when someone participates in nothing yet: "No sessions yet — an admin will add you to
one." Informational, not an error. That is the state a freshly-invited friend lands in, and it is the
first thing this milestone fixes about v0.2.

- [ ] **Step 3: Build `/sessions`**

The same three groupings as a browsable page, reachable from the session screen's switcher. Past
(closed) sessions are viewable here — a vision Must Have.

- [ ] **Step 4: Verify manually and commit**

```bash
npm run dev -w web
```

Signed out `/` shows the splash. Signed in with no pointer shows the chooser. Choosing a session sets
the pointer and lands on it. Reloading `/` goes straight there.

```bash
git add packages/web/src/app packages/web/src/components
git commit -m "feat(web): member home, session chooser, and sessions list

Closes #67"
```

---

## Task 14: Web — live session screen

**GitHub issue:** [#68](https://github.com/pete-the-pete/mangoes/issues/68) · **Blocked by:** #65, #67

The screen the product exists for. Everything else in this milestone is scaffolding for this one.

**Files:**
- Create: `packages/web/src/app/(member)/sessions/[sessionId]/page.tsx`
- Create: `packages/web/src/app/(member)/sessions/[sessionId]/SessionScreen.tsx`
- Create: `packages/web/src/components/TapTarget.tsx`
- Create: `packages/web/src/components/Leaderboard.tsx`
- Create: `packages/web/src/components/SyncBadge.tsx`
- Create: `packages/web/src/components/UndoToast.tsx`

---

- [ ] **Step 1: Build `TapTarget`**

One tap logs +1. **No confirmation, no attribution prompt, no long-press.** A member never chooses
between individual and shared — that choice was removed from the member path entirely, and the word
"shared" never appears here.

```tsx
interface TapTargetProps {
  emoji: string;
  label: string;
  mine: number;
  group: number;
  size: "large" | "grid" | "compact";
  disabled: boolean;      // true once the session is closed
  onTap: () => void;
}
```

`onTap` calls the sync client's `log()`, which writes to IndexedDB and re-renders **before** any
network call. The count must move on the same frame as the tap.

- [ ] **Step 2: Lay out by N**

Layout is mechanical while theming is deferred. Read the session's item types in
`cycle_item_types.position` order and pick:

| Item types | Layout |
|---|---|
| 1 | one `size="large"` target filling the tap area |
| 2–4 | a 2-column grid of `size="grid"` targets |
| 5+ | a scrollable 3-column grid of `size="compact"` targets |

Usable one-handed is this slice's bar. Feeling good is v0.4's.

- [ ] **Step 3: Build `Leaderboard`, `SyncBadge`, `UndoToast`**

- `Leaderboard` renders per-person per-item counts plus a group total per item, from
  `displayedAggregate(state, me)`. Names and avatars come from the snapshot's `participants`.
  **The roster is visible to every participant** — this is where the spec resolves the question v0.2
  left open, because a leaderboard is a roster.
- `SyncBadge` shows queued-vs-synced from `state.pending.length` and `state.online`. It never blocks a
  tap, and it shows the degraded banner when `state.degraded` is true (IndexedDB unavailable).
- `UndoToast` appears after each tap for about five seconds with a single Undo action calling
  `undo(clientEntryId)`. It routes to whichever of the two undo cases applies; the toast does not
  need to know which.

- [ ] **Step 4: Add the overdue banner and the closed state**

When `session.isOverdue` is true, show "This session's end time has passed — an admin can close it."
It **does not block logging**: v0.2 decided close is explicit and `ends_at` passing changes nothing.

When `session.status === "closed"`, render every `TapTarget` disabled and explain that only a session
admin can amend a closed session.

- [ ] **Step 5: Verify manually and commit**

Tap and confirm the count moves instantly. Open the same session in a second browser profile and
confirm the first profile's tap appears there within a few seconds. Undo a tap and confirm both
profiles drop by one.

```bash
git add packages/web/src/app packages/web/src/components
git commit -m "feat(web): live session screen with one-tap logging

Closes #68"
```

---

## Task 15: Web — your-logs page and member group roster

**GitHub issue:** [#69](https://github.com/pete-the-pete/mangoes/issues/69) · **Blocked by:** #65, #68

**Files:**
- Create: `packages/web/src/app/(member)/sessions/[sessionId]/logs/page.tsx`
- Create: `packages/web/src/components/EntryList.tsx`
- Create: `packages/web/src/app/(member)/groups/[groupId]/page.tsx`

---

- [ ] **Step 1: Build `EntryList`**

It reads `store.readMyEntries(sessionId)`, **not the aggregate** — the aggregate is counts-only and
this view needs actual rows. Only your own entries are stored locally, so this list is always
available offline.

Render all three states, visibly distinct:

| State | Rendering |
|---|---|
| `pending` | a queued indicator; delete removes it from the outbox and nothing reaches the server |
| `synced` | plain; delete enqueues a void, which becomes a real append with its own sequence |
| `voiding` | struck through and dimmed until the void is accepted |

- [ ] **Step 2: Build the member group view**

`/groups/[groupId]` — read-only roster and session list for a group the caller belongs to. Gate on
group membership via `cohortStore.getMemberRole`, returning the same "not authorized" shape as
elsewhere rather than revealing whether the group exists.

- [ ] **Step 3: Verify manually and commit**

Log three taps offline via DevTools, open the logs page, confirm all three show as pending, delete
one, and confirm it disappears with no network request. Reconnect and confirm the remaining two go
synced.

```bash
git add packages/web/src/app packages/web/src/components
git commit -m "feat(web): your-logs view and member group roster

Closes #69"
```

---

## Task 16: Web — admin on-behalf and untagged logging control

**GitHub issue:** [#70](https://github.com/pete-the-pete/mangoes/issues/70) · **Blocked by:** #63

**Files:**
- Modify: `packages/web/src/app/admin/groups/[groupId]/sessions/[sessionId]/page.tsx`
- Create: `packages/web/src/app/admin/groups/[groupId]/sessions/[sessionId]/AdminLogControl.tsx`

---

- [ ] **Step 1: Build the control**

A small form on v0.2's session detail page: an item-type select drawn from the session's own
`itemTypeKeys`, a person select over `participantIds` with a **"For the group (nobody in particular)"**
option that posts `subjectUserId: null`, and a Log button.

Follows v0.1's and v0.2's interaction model: optimistic update, rollback plus an error surface on
failure.

Available while the session is closed, since admin writes after close are permitted and members' are
not. Label it plainly — this is the only place the untagged concept is exposed, and it stays out of
member vocabulary entirely.

- [ ] **Step 2: Show the session's entries with a void action**

A list of the session's recent entries with actor, subject (or "group"), item, and time, each with a
remove action calling the void route from Task 9.

- [ ] **Step 3: Verify and commit**

```bash
npm run build -w core && npm run test -w web
git add packages/web/src/app/admin
git commit -m "feat(web): admin on-behalf and untagged logging control

Closes #70"
```

- [ ] **Step 4: Run the offline verification checklist**

No E2E in this milestone, consistent with v0.1 and v0.2. That leaves "0% silent data loss for
offline-queued logs" resting on manual verification, so the verification is written down rather than
left to memory. **This checklist is part of the milestone's definition of done**, and it is the first
thing to automate when E2E arrives.

1. Open one live session in two browser profiles signed in as two different participants.
2. In profile A, set DevTools Network to Offline. Log five taps across at least two item types.
3. Confirm all five render with a pending indicator and A's own totals include them.
4. Restore connectivity. Confirm all five flip to synced, and that
   `SELECT count(*) FROM ledger_entries WHERE cycle_id = '<id>'` returns exactly five — not four, not ten.
5. Confirm profile B converges to the same totals without a reload.
6. In A, undo one synced entry. Confirm B's totals drop by one.
7. Reload A cold with the network still offline. Confirm the leaderboard still renders from the local
   aggregate.

Record the result in a comment on #70.

---

## Definition of Done

- [ ] All 16 issues closed by merged PRs, each with `Closes #N`.
- [ ] `npm run build` clean from the repo root (builds `core`, then `web`).
- [ ] `npm run test -w core` and `npm run test -w web` green, with real output pasted into the final PR.
- [ ] `npm run typecheck -w core` clean.
- [ ] The offline checklist in Task 16 run and its result recorded.
- [ ] A freshly-invited platform `member` who is added to a group and a session can sign in, land on
      that session, tap, and see their count — the gap v0.2 named, closed.
- [ ] No new lint regressions beyond the pre-existing #21 breakage.

## Shipped So Far

| Task | Issue | PR | Notes |
|---|---|---|---|
| 1 | #55 | #73 (merged) | Two corrections folded back into this doc: `clock_timestamp()` over `now()`, and item-type pre-validation instead of catching the FK violation |
| 2 | #56 | #74 | Added Step 3b, the fold-vs-SQL cross-check |

## Spec Deviations Recorded Here

One place where this plan corrects the spec rather than following it, fixed in the spec in the same
commit as this plan:

**Web route tests mock the store layer; they do not run against a test Postgres.** The spec's Testing
section says otherwise, but v0.1 and v0.2 both `vi.mock("@/lib/db", …)`. Real Postgres is used by
`packages/core` store tests only — which is where it earns its keep, since Task 1's concurrency test
is meaningless against a mock.
