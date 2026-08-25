import { emptyAggregate, foldEntries, type Aggregate, type LedgerEntry } from "core";
import type { EntryJson } from "@/lib/ledgerJson";
import { openSyncStoreOrNull, toWireOp, type FlushOutcome, type OutboxOp, type SyncStore } from "./store";
import { currentConnection, pickTransport } from "./transport";

const POLL_INTERVAL_MS = 15_000;

/**
 * Defensive cap on how many delta pages `pullDelta` will drain in one call.
 * The server's own page size (`DELTA_PAGE_SIZE`, 500) makes this astronomically
 * larger than any real backlog — it exists purely so a server bug that always
 * reports `hasMore: true` can't wedge the client in an infinite loop.
 */
const MAX_DELTA_PAGES = 200;

export interface SyncState {
  aggregate: Aggregate; // stored counts, server-confirmed
  pending: OutboxOp[]; // not yet accepted
  degraded: boolean; // IndexedDB unavailable — online-only, show a banner
  online: boolean;
}

interface DeltaPageJson {
  entries: EntryJson[];
  nextCursor: number;
  hasMore: boolean;
}

/**
 * The wire shape (`EntryJson`, see `@/lib/ledgerJson`) omits fields `foldEntries`
 * never reads (`cycleId`, `voidsEntryId`, `createdAt`) to keep the delta/stream
 * payload small. This fills them back in so the result satisfies `LedgerEntry`:
 * `cycleId` from the session this entry was fetched for, `voidsEntryId` as
 * `null` (unused downstream — `foldEntries` keys off `kind`, not this field),
 * and `createdAt` mirrored from `occurredAt` (the wire never sends a separate
 * value for it).
 */
export function reviveEntry(json: EntryJson, sessionId: string): LedgerEntry {
  const occurredAt = new Date(json.occurredAt);
  return {
    id: json.id,
    cycleId: sessionId,
    seq: json.seq,
    kind: json.kind,
    itemTypeKey: json.itemTypeKey,
    subjectUserId: json.subjectUserId,
    actorUserId: json.actorUserId,
    voidsEntryId: null,
    clientEntryId: json.clientEntryId,
    occurredAt,
    createdAt: occurredAt,
  };
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

/**
 * Prunes just-confirmed ops out of the pending list before the store's own
 * `settleFlush` has necessarily caught up with them.
 *
 * A background delta pull or SSE push can learn a client's own write landed
 * (its `clientEntryId` shows up among the incoming entries) before that
 * write's own `flush()` call gets its POST response and calls `settleFlush`
 * — POST latency and the ~2s SSE poll interval overlap. Without this,
 * `displayedAggregate` would fold the same op twice: once for real (now
 * inside `aggregate`) and once as a still-pending optimistic entry.
 *
 * Display-only — it never touches the store, so it can't race `settleFlush`
 * itself. It is also not a complete fix: a later `refreshPending()` (e.g. a
 * concurrent `log`/`undo` re-reading the outbox) re-derives `state.pending`
 * from the store directly and can re-surface the same op until `settleFlush`
 * actually removes it there, briefly reopening this same window. Narrow and
 * self-healing (closes the moment that op's own flush attempt settles), not
 * airtight — see the report for why closing it fully was judged out of scope.
 */
export function dropConfirmed(pending: OutboxOp[], entries: LedgerEntry[]): OutboxOp[] {
  if (pending.length === 0 || entries.length === 0) return pending;
  const confirmed = new Set(entries.map((e) => e.clientEntryId));
  return pending.filter((op) => !confirmed.has(op.clientEntryId));
}

/** What `flushOutbox` did, for the caller to decide whether to refresh state. */
export type FlushResult =
  | { status: "empty" } // nothing unclaimed; no request made
  | { status: "flushed"; outcome: FlushOutcome } // 200, settled (per-op accepted/rejected)
  | { status: "malformed" } // HTTP 400: whole batch rejected pre-write, claim left in place
  | { status: "retry" }; // no interpretable response (network failure, non-400 error, bad JSON)

/**
 * Claims whatever is currently unclaimed in the session's outbox and sends it
 * as one batch. Pure with respect to the network boundary — `fetchImpl` is
 * injectable so this is testable without a browser, per the brief's mandate
 * that the flush loop gets tests for the paths that matter.
 *
 * Three distinct outcomes for a request that got a response, plus one for a
 * request that didn't:
 *
 * - 200: the server's own per-op verdict (`FlushOutcome`) is authoritative.
 *   `settleFlush` reconciles the outbox and `myEntries` against it.
 * - HTTP 400: `parseAppendOps` rejects the ENTIRE batch before any DB write —
 *   so nothing in it reached the server — but there is no per-op `rejected[]`
 *   to settle against, and no way to tell which op was the bad one. The claim
 *   is left exactly as it is: not settled, not aborted. That means these ops
 *   stay owned by this now-abandoned `attemptId` forever, so the NEXT
 *   `beginFlush` call — on the next timer tick, `online` event, etc. — will
 *   not reclaim them, which is what stops this from silently retrying (and
 *   400ing) forever. Newly enqueued ops are unaffected: they're unclaimed by
 *   definition and get swept into a fresh attempt next cycle. Un-wedging the
 *   stuck batch is `evictOp`'s job — deliberately a manual action, not part
 *   of this automatic lifecycle.
 * - Anything else not ok (network failure with no response at all, a non-400
 *   error status, or a 200 whose body isn't parseable JSON): a response this
 *   code cannot interpret as either a real per-op outcome or a definitive
 *   "nothing was written." Per the binding invariant, that means abort over
 *   discard — `abortFlush` releases the claim so the same ops are retried on
 *   the next trigger, never deleted.
 */
export async function flushOutbox(
  store: SyncStore,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FlushResult> {
  const { attemptId, ops } = await store.beginFlush(sessionId);
  if (ops.length === 0) return { status: "empty" };

  let response: Response;
  try {
    response = await fetchImpl(`/api/sessions/${sessionId}/entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: ops.map(toWireOp) }),
    });
  } catch {
    await store.abortFlush(sessionId, attemptId);
    return { status: "retry" };
  }

  if (response.status === 400) {
    return { status: "malformed" };
  }

  if (!response.ok) {
    await store.abortFlush(sessionId, attemptId);
    return { status: "retry" };
  }

  let outcome: FlushOutcome;
  try {
    outcome = (await response.json()) as FlushOutcome;
  } catch {
    await store.abortFlush(sessionId, attemptId);
    return { status: "retry" };
  }

  await store.settleFlush(sessionId, attemptId, outcome);
  return { status: "flushed", outcome };
}

export function createSyncClient(sessionId: string, onChange: (state: SyncState) => void) {
  let store: SyncStore | null = null;
  let state: SyncState = {
    aggregate: emptyAggregate(),
    pending: [],
    degraded: false,
    online: true,
  };
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = () => onChange({ ...state });

  async function refreshPending() {
    state.pending = store ? await store.readOutbox(sessionId) : [];
  }

  async function pullDelta() {
    for (let page = 0; page < MAX_DELTA_PAGES; page++) {
      const response = await fetch(`/api/sessions/${sessionId}/entries?after=${state.aggregate.cursor}`);
      if (!response.ok) return;
      const body = (await response.json()) as DeltaPageJson;
      const entries = body.entries.map((e) => reviveEntry(e, sessionId));
      state.aggregate = foldEntries(state.aggregate, entries);
      state.pending = dropConfirmed(state.pending, entries);
      await store?.writeAggregate(sessionId, state.aggregate);
      emit();
      if (!body.hasMore || body.entries.length === 0) return;
    }
  }

  async function coldOpen() {
    const response = await fetch(`/api/sessions/${sessionId}/snapshot`);
    if (!response.ok) return;
    const body = (await response.json()) as { cursor: number; counts: Aggregate["counts"] };
    state.aggregate = { cursor: body.cursor, counts: body.counts };
    await store?.writeAggregate(sessionId, state.aggregate);
    emit();
  }

  async function flush() {
    if (!store) return;
    // Optimization only: `flushOutbox` itself is safe to call while offline —
    // a failed fetch just takes the "retry" path — this just skips the
    // pointless round trip when we already know it will fail.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const result = await flushOutbox(store, sessionId);
    if (result.status === "malformed") {
      // eslint-disable-next-line no-console -- deliberately surfaced: this batch
      // will never auto-retry; someone needs to notice and call evictOp.
      console.error(
        `sync(${sessionId}): a queued batch was rejected as malformed (HTTP 400) and will not be retried automatically`,
      );
      return;
    }
    if (result.status !== "flushed") return; // "empty" or "retry": nothing to refresh

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
    source.onmessage = (event) => {
      void (async () => {
        const body = JSON.parse(event.data) as DeltaPageJson;
        const entries = body.entries.map((e) => reviveEntry(e, sessionId));
        state.aggregate = foldEntries(state.aggregate, entries);
        state.pending = dropConfirmed(state.pending, entries);
        await store?.writeAggregate(sessionId, state.aggregate);
        emit();
      })();
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

      const onOnline = () => {
        state.online = true;
        emit();
        void sync();
      };
      const onOffline = () => {
        state.online = false;
        emit();
      };
      const onVisible = () => {
        if (document.visibilityState === "visible") void sync();
      };
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

    /**
     * Queues a log locally (optimistic — the UI updates before any network
     * call) and kicks off a flush. When `store` is null (degraded: IndexedDB
     * unavailable), this is a no-op — the caller is expected to check
     * `state.degraded` and POST `/api/sessions/{sessionId}/entries` directly
     * in that case, since there's no offline queue to fall back on.
     *
     * `store.enqueueLog` validates and THROWS on a bad `itemTypeKey`/
     * `subjectUserId` — deliberately not caught here. Catch it at the UI
     * boundary (the component calling this hook), not inside the sync client.
     */
    async log(itemTypeKey: string, subjectUserId: string) {
      if (!store) return;
      await store.enqueueLog(sessionId, { itemTypeKey, subjectUserId });
      await refreshPending();
      emit(); // optimistic, before any network call
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

export type SyncClient = ReturnType<typeof createSyncClient>;
