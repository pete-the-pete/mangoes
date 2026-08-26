"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/sync/useSession";
import { useMyEntries } from "@/lib/sync/useMyEntries";
import type { EntryState } from "@/lib/sync/store";

export interface EntryListItemType {
  key: string;
  emoji: string;
  label: string;
}

export interface EntryListProps {
  sessionId: string;
  me: string;
  itemTypes: EntryListItemType[];
}

function formatTime(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const STATE_COPY: Record<EntryState, string> = {
  pending: "Queued — not yet sent",
  synced: "Logged",
  voiding: "Removing…",
};

/**
 * Your-logs view: reads `store.readMyEntries(sessionId)` (via `useMyEntries`,
 * not the aggregate) because this needs actual rows, not counts. Only your
 * own entries are stored locally, so this is always available offline.
 *
 * Also mounts `useSession` for this session — not to render its aggregate,
 * but to keep the sync engine (cold open, flush timer, online listener,
 * SSE) alive on whichever page this renders on, and as the refresh signal:
 * whenever that hook's `pending`/`aggregate` changes, a flush or delta just
 * settled something in IndexedDB that this list needs to re-read.
 */
export function EntryList({ sessionId, me, itemTypes }: EntryListProps) {
  const { state } = useSession(sessionId, me);
  const { entries, degraded, refresh, remove } = useMyEntries(sessionId);

  useEffect(() => {
    void refresh();
  }, [state.pending, state.aggregate.cursor, refresh]);

  if (degraded) {
    return (
      <p className="rounded bg-amber-100 p-3 text-sm text-amber-800">
        Offline storage unavailable — your logs for this session aren&rsquo;t recorded locally.
      </p>
    );
  }

  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">You haven&rsquo;t logged anything in this session yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => {
        const itemType = itemTypes.find((t) => t.key === entry.itemTypeKey);
        const isVoiding = entry.state === "voiding";
        return (
          <li
            key={entry.clientEntryId}
            className={`flex items-center justify-between gap-2 border-b border-gray-100 py-2 text-sm ${
              isVoiding ? "text-gray-400 line-through" : "text-gray-900"
            }`}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden="true">{itemType?.emoji ?? "•"}</span>
              <span>{itemType?.label ?? entry.itemTypeKey}</span>
              <span className="text-xs text-gray-500">{formatTime(entry.occurredAt)}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className={`text-xs ${entry.state === "pending" ? "text-blue-600" : "text-gray-500"}`}>
                {STATE_COPY[entry.state]}
              </span>
              {!isVoiding && (
                <button
                  type="button"
                  onClick={() => void remove(entry.clientEntryId)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Delete
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
