import { emptyAggregate, foldEntries, type Aggregate, type LedgerEntry } from "core";
import type { EntryJson } from "@/lib/ledgerJson";
import { MAX_BATCH } from "@/lib/appendOps";
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
 * airtight — accepted as a Minor per review; see the report.
 */
export function dropConfirmed(pending: OutboxOp[], entries: LedgerEntry[]): OutboxOp[] {
  if (pending.length === 0 || entries.length === 0) return pending;
  const confirmed = new Set(entries.map((e) => e.clientEntryId));
  return pending.filter((op) => !confirmed.has(op.clientEntryId));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function mergeOutcomes(a: FlushOutcome | undefined, b: FlushOutcome): FlushOutcome {
  if (!a) return b;
  return {
    cursor: Math.max(a.cursor, b.cursor),
    accepted: [...a.accepted, ...b.accepted],
    duplicates: [...a.duplicates, ...b.duplicates],
    rejected: [...a.rejected, ...b.rejected],
  };
}

/**
 * What `flushOutbox` did, for the caller to decide whether to refresh state.
 *
 * `outcome` on `malformed`/`retry` is present only when one or more EARLIER
 * batches in the same claim already settled cleanly before this one stopped
 * the loop (see `flushOutbox`) — the caller should still refresh/pull for
 * that settled prefix even though the overall attempt didn't fully complete.
 */
export type FlushResult =
  | { status: "empty" } // nothing unclaimed; no request made
  | { status: "flushed"; outcome: FlushOutcome } // every batch got a 200 and settled
  | { status: "malformed"; outcome?: FlushOutcome } // a batch 400'd; its ops (and any never-attempted after it) are left claimed
  | { status: "retry"; outcome?: FlushOutcome }; // no interpretable response; claim released for retry

/** Whether `flushOutbox` actually changed anything server-side worth refreshing for. */
function settledSomething(result: FlushResult): boolean {
  switch (result.status) {
    case "flushed":
      return true;
    case "empty":
      return false;
    case "malformed":
    case "retry":
      return result.outcome !== undefined;
  }
}

/**
 * Claims whatever is currently unclaimed in the session's outbox and sends it
 * as one or more batches — chunked at `MAX_BATCH` (the server's own limit,
 * imported rather than duplicated), since `beginFlush` claims every unclaimed
 * op with no cap of its own, and a member who logs across a whole offline
 * weekend can queue well past 500. Pure with respect to the network boundary
 * — `fetchImpl` is injectable so this is testable without a browser, per the
 * brief's mandate that the flush loop gets tests for the paths that matter.
 *
 * Batches are sent strictly in order, and the loop STOPS at the first batch
 * that doesn't cleanly settle (400, or an uninterpretable response) — it never
 * skips ahead to a later batch. That ordering is what keeps `abortFlush` (see
 * below) safe to call: `abortFlush(sessionId, attemptId)` releases every op
 * still owned by `attemptId` with no per-batch selectivity, and `settleFlush`
 * has already durably removed every EARLIER batch's ops from the outbox by
 * the time a later batch fails — so there is never a settled-or-malformed
 * batch still sitting under `attemptId` for a later `abortFlush` call to
 * wrongly sweep up.
 *
 * Per batch:
 * - 200: the server's own per-op verdict (`FlushOutcome`) is authoritative.
 *   `settleFlush` reconciles the outbox and `myEntries` against it. The loop
 *   continues to the next batch.
 * - HTTP 400: `parseAppendOps` rejects the ENTIRE batch before any DB write —
 *   so nothing in it reached the server — but there is no per-op `rejected[]`
 *   to settle against, and no way to tell which op was the bad one. This
 *   batch (and any batches after it in this same claim, never even attempted)
 *   are left exactly as claimed: not settled, not aborted. They stay owned by
 *   this now-abandoned `attemptId` forever, so the NEXT `beginFlush` call — on
 *   the next timer tick, `online` event, etc. — cannot reclaim them, which is
 *   what stops this from silently retrying (and re-400ing) forever. Newly
 *   enqueued ops are unaffected: unclaimed by definition, swept into a fresh
 *   attempt next cycle. Un-wedging the stuck batch is `evictOp`'s job —
 *   deliberately a manual action, not part of this automatic lifecycle.
 * - Anything else not ok (network failure with no response at all, a non-400
 *   error status, or a 200 whose body isn't parseable JSON): a response this
 *   code cannot interpret as either a real per-op outcome or a definitive
 *   "nothing was written." Per the binding invariant, that means abort over
 *   discard — `abortFlush` releases everything still claimed (this batch plus
 *   any not yet attempted) so the same ops are retried on the next trigger,
 *   never deleted. The loop stops here too.
 */
export async function flushOutbox(
  store: SyncStore,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FlushResult> {
  const { attemptId, ops } = await store.beginFlush(sessionId);
  if (ops.length === 0) return { status: "empty" };

  let merged: FlushOutcome | undefined;

  for (const batch of chunk(ops, MAX_BATCH)) {
    let response: Response;
    try {
      response = await fetchImpl(`/api/sessions/${sessionId}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: batch.map(toWireOp) }),
      });
    } catch {
      await store.abortFlush(sessionId, attemptId);
      return { status: "retry", outcome: merged };
    }

    if (response.status === 400) {
      return { status: "malformed", outcome: merged };
    }

    if (!response.ok) {
      await store.abortFlush(sessionId, attemptId);
      return { status: "retry", outcome: merged };
    }

    let outcome: FlushOutcome;
    try {
      outcome = (await response.json()) as FlushOutcome;
    } catch {
      await store.abortFlush(sessionId, attemptId);
      return { status: "retry", outcome: merged };
    }

    await store.settleFlush(sessionId, attemptId, outcome);
    merged = mergeOutcomes(merged, outcome);
  }

  return { status: "flushed", outcome: merged! };
}

export interface PullDeltaResult {
  aggregate: Aggregate;
  pending: OutboxOp[];
}

/**
 * Drains delta pages from `after=aggregate.cursor` forward, folding each page
 * into `aggregate` and pruning any pending op the page just confirmed (see
 * `dropConfirmed`). Stops when a page reports `hasMore: false` (or an empty
 * page), or after `MAX_DELTA_PAGES` as a defensive cap against a server bug
 * that always reports `hasMore: true`.
 *
 * Same error-handling shape as `flushOutbox`: a network failure, a non-ok
 * response, or an unparseable body all stop the drain and return whatever was
 * accumulated so far rather than throwing — a transient GET failure must not
 * take down the caller (`sync()` still needs to run the POST/flush side of
 * the tick right after this), and `fetchImpl` is injectable for the same
 * browser-free testing reason as `flushOutbox`.
 *
 * Deliberately pure/single-shot rather than emitting progress after each
 * page: the caller persists and emits once with the final result. A very
 * long catch-up (many pages) won't paint intermediate progress, which is a
 * real (minor) UX trade-off against the brief's illustrative per-page `emit`,
 * made so this function has no closure state and is directly testable.
 */
export async function pullDelta(
  sessionId: string,
  aggregate: Aggregate,
  pending: OutboxOp[],
  fetchImpl: typeof fetch = fetch,
): Promise<PullDeltaResult> {
  let currentAggregate = aggregate;
  let currentPending = pending;

  for (let page = 0; page < MAX_DELTA_PAGES; page++) {
    let response: Response;
    try {
      response = await fetchImpl(`/api/sessions/${sessionId}/entries?after=${currentAggregate.cursor}`);
    } catch {
      return { aggregate: currentAggregate, pending: currentPending };
    }
    if (!response.ok) return { aggregate: currentAggregate, pending: currentPending };

    let body: DeltaPageJson;
    try {
      body = (await response.json()) as DeltaPageJson;
    } catch {
      return { aggregate: currentAggregate, pending: currentPending };
    }

    const entries = body.entries.map((e) => reviveEntry(e, sessionId));
    currentAggregate = foldEntries(currentAggregate, entries);
    currentPending = dropConfirmed(currentPending, entries);
    if (!body.hasMore || body.entries.length === 0) break;
  }

  return { aggregate: currentAggregate, pending: currentPending };
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
  // True once a cold open against this session has ever SUCCEEDED for this
  // client instance. Gating on this (not on `state.aggregate.cursor === 0`)
  // matters for a session that genuinely has zero entries yet: cursor stays
  // 0 forever, and `/snapshot` is the expensive endpoint (it calls Clerk's
  // getUserList) — re-hitting it every `POLL_INTERVAL_MS` for the session's
  // whole life would be wrong. Seeded from the persisted aggregate in
  // `start()` where possible; see the report for the one case it can't
  // distinguish (a session that is both brand-new to this device AND
  // genuinely still at zero entries still cold-opens once per mount, not
  // forever).
  let hasColdOpened = false;

  const emit = () => onChange({ ...state });

  async function refreshPending() {
    state.pending = store ? await store.readOutbox(sessionId) : [];
  }

  async function runPullDelta() {
    const result = await pullDelta(sessionId, state.aggregate, state.pending);
    state.aggregate = result.aggregate;
    state.pending = result.pending;
    await store?.writeAggregate(sessionId, state.aggregate);
    emit();
  }

  /** Returns whether the cold open actually completed (a real response was parsed). */
  async function coldOpen(): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(`/api/sessions/${sessionId}/snapshot`);
    } catch {
      return false;
    }
    if (!response.ok) return false;

    let body: { cursor: number; counts: Aggregate["counts"] };
    try {
      body = (await response.json()) as { cursor: number; counts: Aggregate["counts"] };
    } catch {
      return false;
    }

    state.aggregate = { cursor: body.cursor, counts: body.counts };
    await store?.writeAggregate(sessionId, state.aggregate);
    emit();
    return true;
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
    }
    // A partial prefix may have settled even on "malformed"/"retry" — refresh
    // whenever anything actually changed server-side.
    if (!settledSomething(result)) return;

    await refreshPending();
    await runPullDelta();
  }

  async function sync() {
    if (!navigator.onLine) return;
    if (!hasColdOpened) {
      hasColdOpened = await coldOpen();
    } else {
      await runPullDelta();
    }
    await flush();
  }

  function openStream() {
    if (pickTransport(currentConnection()) !== "sse") return;
    source = new EventSource(`/api/sessions/${sessionId}/stream?after=${state.aggregate.cursor}`);
    source.onmessage = (event) => {
      void (async () => {
        let body: DeltaPageJson;
        try {
          body = JSON.parse(event.data) as DeltaPageJson;
        } catch {
          return; // a keepalive comment never reaches onmessage; a malformed data line is simply dropped
        }
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
        // A persisted aggregate with a nonzero cursor, or any recorded counts,
        // is proof this device already completed a cold open against this
        // session before — no need to repeat it.
        hasColdOpened = state.aggregate.cursor > 0 || Object.keys(state.aggregate.counts).length > 0;
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
