"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openSyncStoreOrNull, type LocalEntry, type SyncStore } from "./store";

export interface UseMyEntriesResult {
  /** Newest first (same order `store.readMyEntries` already returns). */
  entries: LocalEntry[];
  /** IndexedDB unavailable — there is no local record to show. */
  degraded: boolean;
  refresh(): Promise<void>;
}

/**
 * Reads this device's own logged entries for `sessionId` — the your-logs
 * view. Deliberately separate from `useSession`: that hook's `SyncState` is
 * counts-only (`aggregate`/`pending`), never the actual `myEntries` rows a
 * delete-a-row UI needs. `refresh()` is exposed rather than run on a timer
 * so the caller decides when to re-read — typically whenever a co-mounted
 * `useSession` for the same session reports its `pending`/`aggregate`
 * changed, since that's the signal a flush just settled (a pending row went
 * synced) or a void just landed.
 *
 * Read-only on purpose — no `undo`/`remove` here. Deleting a row needs
 * `store.undo`, but calling it through THIS hook's own separately-opened
 * store handle would queue the write correctly and then leave it waiting
 * for whatever `useSession` instance happens to be running its flush timer
 * next (up to 15s, or an online/visibility event) — that hook's client owns
 * the flush loop and calls `void flush()` immediately after `undo`, so
 * callers should route deletes through `useSession(sessionId, ...).undo`
 * instead (see `EntryList`).
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

  return { entries, degraded, refresh };
}
