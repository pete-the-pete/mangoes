import { openDB, type DBSchema, type IDBPDatabase } from "idb";
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

/** The exact shape `parseAppendOps` (packages/web/src/lib/appendOps.ts) accepts. */
export interface WireAppendOp {
  clientEntryId: string;
  kind: "log" | "void";
  itemTypeKey?: string;
  voidsClientEntryId?: string;
  occurredAt: string;
}

/**
 * Projects a local OutboxOp onto the wire schema the write API validates.
 *
 * A whitelist, not a blacklist: `sessionId` and `subjectUserId` are local/display
 * fields the server never sees. `parseAppendOps` 400s the ENTIRE batch on the
 * first op with an unexpected `subjectUserId` key present at all (member writes
 * always credit the actor), so this store must never hand the flush path a raw
 * OutboxOp — only this projection.
 */
export function toWireOp(op: OutboxOp): WireAppendOp {
  if (op.kind === "log") {
    return { clientEntryId: op.clientEntryId, kind: "log", itemTypeKey: op.itemTypeKey, occurredAt: op.occurredAt };
  }
  return {
    clientEntryId: op.clientEntryId,
    kind: "void",
    voidsClientEntryId: op.voidsClientEntryId,
    occurredAt: op.occurredAt,
  };
}

interface SyncDB extends DBSchema {
  // Keyed by sessionId (out-of-line key) so one member in several sessions
  // keeps them separate.
  aggregates: {
    key: string;
    value: Aggregate;
  };
  outbox: {
    key: string;
    value: OutboxOp;
    indexes: { bySession: string };
  };
  myEntries: {
    key: string;
    value: LocalEntry;
    indexes: { bySession: string };
  };
}

async function open(): Promise<IDBPDatabase<SyncDB>> {
  return openDB<SyncDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
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

  async function readAggregate(sessionId: string): Promise<Aggregate> {
    return (await db.get("aggregates", sessionId)) ?? emptyAggregate();
  }

  /**
   * Cursor values are monotonic on the server; this store must never let a
   * persisted cursor move backwards. A cold-open snapshot fetched after a delta
   * page or SSE push has already advanced the local aggregate would otherwise
   * regress it — so a write whose cursor is behind what's already stored is
   * silently ignored rather than applied.
   */
  async function writeAggregate(sessionId: string, aggregate: Aggregate): Promise<void> {
    const current = await db.get("aggregates", sessionId);
    if (current && aggregate.cursor < current.cursor) return;
    await db.put("aggregates", aggregate, sessionId);
  }

  async function readOutbox(sessionId: string): Promise<OutboxOp[]> {
    const ops = await db.getAllFromIndex("outbox", "bySession", sessionId);
    // Order matters: a batch containing an entry and its void must arrive that way.
    return ops.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  async function readMyEntries(sessionId: string): Promise<LocalEntry[]> {
    const entries = await db.getAllFromIndex("myEntries", "bySession", sessionId);
    return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  async function enqueueLog(
    sessionId: string,
    input: { itemTypeKey: string; subjectUserId: string },
  ): Promise<LocalEntry> {
    const clientEntryId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const entry: LocalEntry = { clientEntryId, sessionId, ...input, occurredAt, state: "pending" };
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    await tx.objectStore("outbox").put({
      clientEntryId,
      sessionId,
      kind: "log",
      itemTypeKey: input.itemTypeKey,
      subjectUserId: input.subjectUserId,
      occurredAt,
    });
    await tx.objectStore("myEntries").put(entry);
    await tx.done;
    return entry;
  }

  /**
   * Raw primitive: unconditionally queues a void for a target that is already
   * synced, copying its item and subject onto the void op for immediate local
   * display, and marks the target "voiding". No-ops if the target is unknown or
   * not currently "synced" (already voiding, or never synced at all) — callers
   * that must first decide *whether* a void applies should go through `undo`,
   * which does that dispatch and then calls this.
   */
  async function enqueueVoid(sessionId: string, voidsClientEntryId: string): Promise<void> {
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    const mine = tx.objectStore("myEntries");
    const entry = await mine.get(voidsClientEntryId);
    if (!entry || entry.state !== "synced") {
      await tx.done;
      return;
    }
    await tx.objectStore("outbox").put({
      clientEntryId: crypto.randomUUID(),
      sessionId,
      kind: "void",
      voidsClientEntryId,
      // Copied so the UI can decrement now rather than when the void syncs.
      itemTypeKey: entry.itemTypeKey,
      subjectUserId: entry.subjectUserId,
      occurredAt: new Date().toISOString(),
    });
    await mine.put({ ...entry, state: "voiding" });
    await tx.done;
  }

  /**
   * Undo is two cases, and the second is where bugs live.
   *
   *  - target still pending (never reached the server): drop it from the outbox
   *    and from myEntries. No tombstone ever reaches the server, because the
   *    server never heard about it.
   *  - target already synced: enqueue a void via `enqueueVoid`. That is a real
   *    append — it takes a sequence and propagates to every other client.
   */
  async function undo(sessionId: string, clientEntryId: string): Promise<void> {
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

    const entry = await mine.get(clientEntryId);
    await tx.done;
    if (!entry || entry.state !== "synced") {
      // Nothing to undo: unknown entry, or already voiding.
      return;
    }
    await enqueueVoid(sessionId, clientEntryId);
  }

  /**
   * Settles a flush response against the outbox and myEntries.
   *
   * - accepted/duplicate log: outbox entry clears, myEntries moves pending -> synced.
   * - accepted/duplicate void: outbox entry clears, the voided target is removed
   *   from myEntries — there is no "voided" EntryState, so once a void has really
   *   landed there is nothing further for the member to act on.
   * - rejected log: dropped rather than retried forever, per the write API's
   *   idempotency contract — a rejection is permanent, not a transient failure.
   * - rejected void: dropped, and the target reverts voiding -> synced, since the
   *   undo never took effect.
   */
  async function settleFlush(sessionId: string, outcome: FlushOutcome): Promise<void> {
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const mine = tx.objectStore("myEntries");

    for (const id of [...outcome.accepted, ...outcome.duplicates]) {
      const op = await outbox.get(id);
      await outbox.delete(id);
      if (!op) continue;
      if (op.kind === "log") {
        const entry = await mine.get(id);
        if (entry && entry.state === "pending") {
          await mine.put({ ...entry, state: "synced" });
        }
      } else if (op.voidsClientEntryId) {
        await mine.delete(op.voidsClientEntryId);
      }
    }

    for (const rejection of outcome.rejected) {
      const op = await outbox.get(rejection.clientEntryId);
      await outbox.delete(rejection.clientEntryId);
      if (op?.kind === "void" && op.voidsClientEntryId) {
        const target = await mine.get(op.voidsClientEntryId);
        if (target && target.state === "voiding") {
          await mine.put({ ...target, state: "synced" });
        }
      } else {
        await mine.delete(rejection.clientEntryId);
      }
    }
    await tx.done;
  }

  async function clearSession(sessionId: string): Promise<void> {
    const tx = db.transaction(["aggregates", "outbox", "myEntries"], "readwrite");
    await tx.objectStore("aggregates").delete(sessionId);
    for (const name of ["outbox", "myEntries"] as const) {
      const idStore = tx.objectStore(name);
      const keys = await idStore.index("bySession").getAllKeys(sessionId);
      for (const key of keys) await idStore.delete(key);
    }
    await tx.done;
  }

  return {
    readAggregate,
    writeAggregate,
    readOutbox,
    readMyEntries,
    enqueueLog,
    enqueueVoid,
    undo,
    settleFlush,
    clearSession,
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
