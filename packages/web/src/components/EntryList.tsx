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
  /** True for a viewer who isn't a session participant (e.g. the platform
   *  owner looking via the member API's superuser bypass) — there is
   *  nothing of theirs to delete, so the delete action is hidden rather
   *  than wired to an id that was never this viewer's own. */
  readOnly?: boolean;
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
 * but for two things: (1) to keep the sync engine (cold open, flush timer,
 * online listener, SSE) alive on whichever page this renders on, and as the
 * refresh signal for `useMyEntries`; (2) delete routes through THIS hook's
 * own `undo`, not `useMyEntries`'s separate store handle — `useSession`'s
 * client is the one that owns the flush loop, and its `undo` calls
 * `void flush()` immediately after queuing a void, instead of leaving it to
 * wait for the next poll tick (up to 15s) or an online/visibility event.
 * `useMyEntries` keeps its own store handle purely for reading rows; writing
 * through it would queue the void correctly but never prompt a flush,
 * leaving "Removing…" visibly stuck.
 */
export function EntryList({ sessionId, me, itemTypes, readOnly = false }: EntryListProps) {
  const { state, undo } = useSession(sessionId, me);
  const { entries, degraded, refresh } = useMyEntries(sessionId);

  // Depend on primitives, not `state.pending` itself: `refreshPending()`
  // (inside client.ts) assigns a brand-new array on every poll tick and SSE
  // push, so a reference-based dependency would re-read `readMyEntries` on
  // every sync tick regardless of whether anything relevant changed. Length
  // plus cursor only change when something this list would actually need to
  // reflect (a flush settled, a void landed, a delta advanced) happened.
  useEffect(() => {
    void refresh();
  }, [state.pending.length, state.aggregate.cursor, refresh]);

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
              {!isVoiding && !readOnly && (
                <button
                  type="button"
                  onClick={() => void undo(entry.clientEntryId)}
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
