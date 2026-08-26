"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openSyncStoreOrNull, type LocalEntry, type SyncStore } from "./store";

export interface UseMyEntriesResult {
  /** Newest first (same order `store.readMyEntries` already returns). */
  entries: LocalEntry[];
  /** IndexedDB unavailable — there is no local record to show. */
  degraded: boolean;
  refresh(): Promise<void>;
  /**
   * Routes to `store.undo`, which is itself already the right two-case
   * dispatch for "delete" here: a still-unclaimed pending log is dropped
   * with no network call; anything else (synced, or claimed by a live
   * flush) is queued as a void. This hook doesn't need its own delete
   * primitive — it needs a home for the store handle so a component never
   * reaches past a hook into the store directly (see useSession).
   */
  remove(clientEntryId: string): Promise<void>;
}

/**
 * Reads this device's own logged entries for `sessionId` — the your-logs
 * view. Deliberately separate from `useSession`: that hook's `SyncState` is
 * counts-only (`aggregate`/`pending`), never the actual `myEntries` rows a
 * delete-a-row UI needs. `refresh()` is exposed rather than run on a timer
 * so the caller decides when to re-read — typically whenever a co-mounted
 * `useSession` for the same session reports its `pending`/`aggregate`
 * changed, since that's the signal a flush just settled (a pending row went
 * synced) or a void this hook queued just landed.
 */
export function useMyEntries(sessionId: string): UseMyEntriesResult {
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [degraded, setDegraded] = useState(false);
  const storeRef = useRef<SyncStore | null>(null);

  const refresh = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    setEntries(await store.readMyEntries(sessionId));
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    storeRef.current = null;
    setEntries([]);

    void (async () => {
      const store = await openSyncStoreOrNull();
      if (cancelled) return;
      storeRef.current = store;
      setDegraded(store === null);
      if (store) setEntries(await store.readMyEntries(sessionId));
    })();

    return () => {
      cancelled = true;
      storeRef.current = null;
    };
  }, [sessionId]);

  const remove = useCallback(
    async (clientEntryId: string) => {
      const store = storeRef.current;
      if (!store) return;
      await store.undo(sessionId, clientEntryId);
      await refresh();
    },
    [sessionId, refresh],
  );

  return { entries, degraded, refresh, remove };
}
