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
  /**
   * Set only while state is "voiding": the outbox clientEntryId of the void
   * queued to resolve it. This is the durable side of the log<->void
   * correlation — settleFlush uses it to find and revert/clear a target even
   * if the void's own outbox row has already been evicted or is otherwise
   * missing by settle time, rather than depending on that transient row.
   */
  voidClientEntryId?: string;
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
  /**
   * The id of the flush attempt that currently owns this op, set by
   * `beginFlush` and cleared by `settleFlush` (via deletion) or `abortFlush`.
   * Ownership is per-op, not per-session: an op with no attemptId has never
   * been claimed (or was released by an abort) and is fair game for the next
   * `beginFlush` call; an op WITH an attemptId belongs exclusively to that one
   * flush attempt, which MAY already have reached the server even though this
   * store hasn't heard back — that's what makes undo's second case necessary,
   * and what stops one attempt's abort from touching another, still-live
   * attempt's ops.
   */
  attemptId?: string;
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
 * A whitelist, not a blacklist: `sessionId`, `subjectUserId`, and `attemptId` are
 * local/bookkeeping fields the server never sees. `parseAppendOps` 400s the
 * ENTIRE batch on the first op with an unexpected `subjectUserId` key present at
 * all (member writes always credit the actor), so this store must never hand the
 * flush path a raw OutboxOp — only this projection.
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

/** Return of `beginFlush`: the attempt's id, and the ops it actually claimed. */
export interface FlushAttempt {
  attemptId: string;
  ops: OutboxOp[];
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
   *
   * Read-modify-write happens inside ONE readwrite transaction: a bare
   * `db.get`/`db.put` pair is each its own implicit transaction, which leaves a
   * window for two concurrent writers (e.g. a cold-open snapshot and an SSE
   * push) to both read the same prior value and race on which `put` lands last,
   * regardless of cursor order. A single transaction serializes against any
   * other transaction touching "aggregates", closing that window.
   */
  async function writeAggregate(sessionId: string, aggregate: Aggregate): Promise<void> {
    const tx = db.transaction("aggregates", "readwrite");
    const store = tx.objectStore("aggregates");
    const current = await store.get(sessionId);
    if (!current || aggregate.cursor >= current.cursor) {
      await store.put(aggregate, sessionId);
    }
    await tx.done;
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

  /**
   * Claims every currently-UNCLAIMED op in a session's outbox for a fresh flush
   * attempt (a new `attemptId`), stamps them, and returns both. Ownership is
   * per-op: an op already carrying another attempt's id (that attempt hasn't
   * settled or aborted yet) is left alone and NOT included in the claim — so
   * calling this again before a prior attempt resolves never "silently claims
   * more" of that attempt's ops. If there is nothing unclaimed, it still
   * returns a fresh `attemptId` paired with an empty `ops` array (an explicit
   * empty claim, not an error) — safe for the caller to `abortFlush`/
   * `settleFlush` against with nothing to do.
   *
   * Once claimed, an op is considered to MAYBE have reached the server —
   * `undo` treats it accordingly — until `settleFlush` resolves it or
   * `abortFlush` releases it back to unclaimed.
   *
   * Contract for the caller: each returned claim is exactly one HTTP request's
   * worth of ops (`ops.map(toWireOp)` -> one `POST /entries` body). Two
   * overlapping `beginFlush` calls are safe and produce two independent
   * claims with disjoint ops — but each claim's response must be settled (or
   * aborted) with the `attemptId` it was issued, never a different attempt's.
   */
  async function beginFlush(sessionId: string): Promise<FlushAttempt> {
    const attemptId = crypto.randomUUID();
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    const all = await store.index("bySession").getAll(sessionId);
    const claimed: OutboxOp[] = [];
    for (const op of all) {
      if (op.attemptId !== undefined) continue; // owned by another live attempt
      const withAttempt: OutboxOp = { ...op, attemptId };
      await store.put(withAttempt);
      claimed.push(withAttempt);
    }
    await tx.done;
    claimed.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    return { attemptId, ops: claimed };
  }

  /**
   * Releases every op claimed by exactly this attempt — for when a flush's
   * request never got a response at all (network failure, timeout) rather than
   * a real per-op outcome, so those ops are eligible for the next `beginFlush`
   * instead of being stuck "maybe in flight" forever. Scoped strictly to
   * `attemptId`: an op some other, still-live attempt claimed in the meantime
   * is left untouched.
   */
  async function abortFlush(sessionId: string, attemptId: string): Promise<void> {
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    const all = await store.index("bySession").getAll(sessionId);
    for (const op of all) {
      if (op.attemptId === attemptId) {
        const released: OutboxOp = { ...op };
        delete released.attemptId;
        await store.put(released);
      }
    }
    await tx.done;
  }

  async function enqueueLog(
    sessionId: string,
    input: { itemTypeKey: string; subjectUserId: string },
  ): Promise<LocalEntry> {
    const itemTypeKey = input.itemTypeKey.trim();
    if (itemTypeKey.length === 0) {
      throw new Error("enqueueLog: itemTypeKey must not be empty or whitespace");
    }
    if (input.subjectUserId.length === 0) {
      throw new Error("enqueueLog: subjectUserId must not be empty");
    }
    const clientEntryId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const entry: LocalEntry = {
      clientEntryId,
      sessionId,
      itemTypeKey,
      subjectUserId: input.subjectUserId,
      occurredAt,
      state: "pending",
    };
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    await tx.objectStore("outbox").put({
      clientEntryId,
      sessionId,
      kind: "log",
      itemTypeKey,
      subjectUserId: input.subjectUserId,
      occurredAt,
    });
    await tx.objectStore("myEntries").put(entry);
    await tx.done;
    return entry;
  }

  /**
   * Raw primitive: unconditionally queues a void for a target that is
   * currently "synced", copying its item and subject onto the void op for
   * immediate local display, and marks the target "voiding". No-ops if the
   * target is unknown or not currently "synced" (already voiding, or never
   * synced at all).
   *
   * This only covers the simple case (target definitely synced, nothing
   * claimed by a flush attempt). `undo` has one more case to dispatch — a
   * target that's still in the outbox but claimed by an attempt, which MAY
   * have already reached the server — so it doesn't delegate here; it shares
   * the void-queuing write directly.
   */
  async function enqueueVoid(sessionId: string, voidsClientEntryId: string): Promise<void> {
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const mine = tx.objectStore("myEntries");
    const entry = await mine.get(voidsClientEntryId);
    if (!entry || entry.state !== "synced") {
      await tx.done;
      return;
    }
    const voidClientEntryId = crypto.randomUUID();
    await outbox.put({
      clientEntryId: voidClientEntryId,
      sessionId,
      kind: "void",
      voidsClientEntryId: entry.clientEntryId,
      // Copied so the UI can decrement now rather than when the void syncs.
      itemTypeKey: entry.itemTypeKey,
      subjectUserId: entry.subjectUserId,
      occurredAt: new Date().toISOString(),
    });
    await mine.put({ ...entry, state: "voiding", voidClientEntryId });
    await tx.done;
  }

  /**
   * Undo is two cases, and the second is where bugs live.
   *
   *  - target still queued and UNCLAIMED by any flush attempt (never reached
   *    the server): drop it from the outbox and from myEntries. No tombstone
   *    ever reaches the server, because the server never heard about it.
   *  - target already synced, OR still queued but claimed by a live attempt (a
   *    flush has sent it and this store hasn't heard back — it MAY already
   *    have reached the server): enqueue a void. That is a real append — it
   *    takes a sequence and propagates to every other client. The
   *    non-negotiable invariant: an op that may have reached the server is
   *    never deleted locally, only voided.
   */
  async function undo(sessionId: string, clientEntryId: string): Promise<void> {
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const mine = tx.objectStore("myEntries");

    const entry = await mine.get(clientEntryId);
    if (!entry || entry.state === "voiding") {
      // Nothing to undo: unknown entry, or already voiding.
      await tx.done;
      return;
    }

    const op = await outbox.get(clientEntryId);
    if (op && op.kind === "log" && op.attemptId === undefined) {
      await outbox.delete(clientEntryId);
      await mine.delete(clientEntryId);
      await tx.done;
      return;
    }

    // Either already synced (no outbox row left), or still queued but claimed
    // by a live flush attempt: never delete, always void.
    const voidClientEntryId = crypto.randomUUID();
    await outbox.put({
      clientEntryId: voidClientEntryId,
      sessionId,
      kind: "void",
      voidsClientEntryId: entry.clientEntryId,
      // Copied so the UI can decrement now rather than when the void syncs.
      itemTypeKey: entry.itemTypeKey,
      subjectUserId: entry.subjectUserId,
      occurredAt: new Date().toISOString(),
    });
    await mine.put({ ...entry, state: "voiding", voidClientEntryId });
    await tx.done;
  }

  /**
   * Forcibly removes one op from the outbox — the escape hatch for a wedged
   * batch. `parseAppendOps` 400s the ENTIRE batch on the first malformed op
   * (returns on first schema failure), so if a bad op ever got queued despite
   * `enqueueLog`'s validation, nothing behind it in the same session's outbox
   * could ever flush again without a way to evict it.
   *
   * Evicting a "void" reverts its target back to "synced" first, so the target
   * is never left stuck "voiding" with nothing left in the outbox to resolve
   * it. Evicting a "log" drops its myEntries record too (same as an outright
   * rejection). Not attempt-scoped — this is an explicit, manual recovery
   * action, not part of the flush lifecycle.
   */
  async function evictOp(sessionId: string, clientEntryId: string): Promise<void> {
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const mine = tx.objectStore("myEntries");

    const op = await outbox.get(clientEntryId);
    if (op && op.sessionId !== sessionId) {
      // Refuse to evict an op scoped to a different session under this id.
      await tx.done;
      return;
    }
    await outbox.delete(clientEntryId);
    if (op?.kind === "void" && op.voidsClientEntryId) {
      const target = await mine.get(op.voidsClientEntryId);
      if (target && target.state === "voiding" && target.voidClientEntryId === clientEntryId) {
        const reverted: LocalEntry = { ...target, state: "synced" };
        delete reverted.voidClientEntryId;
        await mine.put(reverted);
      }
    } else if (op?.kind === "log") {
      await mine.delete(clientEntryId);
    }
    await tx.done;
  }

  /**
   * Settles one flush attempt's response against the outbox and myEntries.
   * `attemptId` must match — an id in `outcome` whose outbox row is currently
   * owned by a DIFFERENT, still-live attempt is left untouched (defends
   * against a stale response from an aborted/superseded attempt touching ops a
   * newer attempt has since claimed). If the outbox row is already gone
   * (e.g. evicted in the interim) settling still proceeds via the durable
   * myEntries-based correlation below — there's no other live attempt to
   * conflict with in that case.
   *
   * Deliberately does NOT depend on the outbox still holding the op being
   * settled to determine its correlation (Minor finding: relying on
   * `outbox.get(id)` to learn an op's kind left a rejected void's target stuck
   * "voiding" forever if that row was ever missing by settle time). Instead:
   * an id that's a key in myEntries is a log's own id; otherwise it's checked
   * against every "voiding" myEntries record's `voidClientEntryId` — the
   * durable side of the correlation.
   *
   * - accepted/duplicate log: outbox entry clears, myEntries moves pending -> synced.
   * - accepted/duplicate void: outbox entry clears, the voided target is removed
   *   from myEntries — there is no "voided" EntryState, so once a void has really
   *   landed there is nothing further for the member to act on.
   * - rejected log: dropped rather than retried forever, per the write API's
   *   idempotency contract — a rejection is permanent, not a transient failure.
   *   If a void had been queued against it in the meantime (the in-flight race
   *   `undo` guards against), that now-orphaned void is dropped too, rather
   *   than shipping a void whose target never existed.
   * - rejected void, reason "already_voided": the server says it's already
   *   gone, so the target is dropped — reverting to "synced" would just re-arm
   *   an undo button that can only ever produce another already_voided.
   * - rejected void, any other reason: dropped, and the target reverts
   *   voiding -> synced, since the undo never took effect.
   */
  async function settleFlush(sessionId: string, attemptId: string, outcome: FlushOutcome): Promise<void> {
    const tx = db.transaction(["outbox", "myEntries"], "readwrite");
    const outbox = tx.objectStore("outbox");
    const mine = tx.objectStore("myEntries");

    async function findVoidingTarget(voidClientEntryId: string): Promise<LocalEntry | undefined> {
      const candidates = await mine.index("bySession").getAll(sessionId);
      return candidates.find((e) => e.state === "voiding" && e.voidClientEntryId === voidClientEntryId);
    }

    /** True unless the outbox row exists and belongs to a different, live attempt. */
    async function ownedByThisAttempt(id: string): Promise<boolean> {
      const op = await outbox.get(id);
      if (!op) return true; // already gone; nothing else can own it
      return op.attemptId === attemptId;
    }

    for (const id of [...outcome.accepted, ...outcome.duplicates]) {
      if (!(await ownedByThisAttempt(id))) continue;
      await outbox.delete(id);
      const asLog = await mine.get(id);
      if (asLog) {
        if (asLog.state === "pending") {
          await mine.put({ ...asLog, state: "synced" });
        }
        continue;
      }
      const target = await findVoidingTarget(id);
      if (target) {
        await mine.delete(target.clientEntryId);
      }
    }

    for (const rejection of outcome.rejected) {
      if (!(await ownedByThisAttempt(rejection.clientEntryId))) continue;
      await outbox.delete(rejection.clientEntryId);
      const asLog = await mine.get(rejection.clientEntryId);
      if (asLog) {
        if (asLog.voidClientEntryId) {
          await outbox.delete(asLog.voidClientEntryId);
        }
        await mine.delete(rejection.clientEntryId);
        continue;
      }
      const target = await findVoidingTarget(rejection.clientEntryId);
      if (target) {
        if (rejection.reason === "already_voided") {
          await mine.delete(target.clientEntryId);
        } else {
          const reverted: LocalEntry = { ...target, state: "synced" };
          delete reverted.voidClientEntryId;
          await mine.put(reverted);
        }
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
    beginFlush,
    abortFlush,
    enqueueLog,
    enqueueVoid,
    undo,
    evictOp,
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
