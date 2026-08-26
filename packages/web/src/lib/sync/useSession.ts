"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { emptyAggregate, type Aggregate } from "core";
import { createSyncClient, displayedAggregate, type SyncState } from "./client";

function initialState(): SyncState {
  return { aggregate: emptyAggregate(), pending: [], degraded: false, online: true };
}

/**
 * Thin React wrapper around `createSyncClient`. All orchestration logic
 * (cold open, delta pull, outbox flush, transport selection) lives in
 * `client.ts`, which is plain TS and testable without React — this hook only
 * wires it into component lifecycle and re-render state.
 *
 * `subjectUserId` is the signed-in member's own id (from Clerk on the caller's
 * side) — needed to fold this device's pending ops into `displayed` (see
 * `displayedAggregate`), not fetched internally so this module stays decoupled
 * from auth.
 *
 * Returns `{ state, displayed, log, undo }`:
 * - `state.aggregate` is server-confirmed counts only.
 * - `displayed` is `state.aggregate` folded with this device's still-pending
 *   outbox ops — what the UI should actually render, so a tap (and its undo)
 *   shows up instantly and never double-counts once the server's own copy of
 *   the same op arrives.
 * - `state.degraded === true` means IndexedDB is unavailable: `log`/`undo`
 *   below are no-ops in that case (there's no offline queue to write into) —
 *   show a banner and, if logging must still work, POST
 *   `/api/sessions/{sessionId}/entries` directly instead of calling `log`.
 * - `log`/`undo` reject if the underlying `store.enqueueLog` validation
 *   throws (e.g. an empty `itemTypeKey`) — catch at the call site, not here.
 */
export function useSession(sessionId: string, subjectUserId: string) {
  const [state, setState] = useState<SyncState>(initialState);
  const clientRef = useRef<ReturnType<typeof createSyncClient> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;

    setState(initialState());
    const client = createSyncClient(sessionId, (next) => {
      if (!cancelled) setState(next);
    });
    clientRef.current = client;

    void client.start().then((cleanup) => {
      if (cancelled) {
        // Unmounted before start() finished its async setup — tear down
        // immediately rather than leaving listeners/timers/the EventSource
        // running past the component's lifetime.
        cleanup();
        return;
      }
      stop = cleanup;
    });

    return () => {
      cancelled = true;
      stop?.();
      clientRef.current = null;
    };
  }, [sessionId]);

  const displayed: Aggregate = useMemo(
    () => displayedAggregate(state, subjectUserId),
    [state, subjectUserId],
  );

  return {
    state,
    displayed,
    log(itemTypeKey: string, forSubjectUserId: string) {
      return clientRef.current?.log(itemTypeKey, forSubjectUserId) ?? Promise.resolve();
    },
    undo(clientEntryId: string) {
      return clientRef.current?.undo(clientEntryId) ?? Promise.resolve();
    },
  };
}
