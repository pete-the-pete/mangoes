"use client";

import { useEffect } from "react";
import { Card } from "./ui/Card";
import { Label } from "./ui/Label";
import { Pill } from "./ui/Pill";
import { cn } from "./ui/cn";
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

/**
 * HH:MM for the 52px time column of screen 6. Every entry here belongs to one
 * session, so repeating the date per row spends the whole column on a value
 * that rarely changes — but a session can run past midnight, so the full UTC
 * timestamp stays on the <time> element rather than being thrown away.
 */
function formatClock(iso: string): string {
  return `${iso.slice(11, 16)} UTC`;
}

function formatFull(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const STATE_COPY: Record<EntryState, string> = {
  pending: "Queued",
  synced: "Logged",
  voiding: "Removing",
};

/** Screen 6's tag-badge colors: yellow for in-flight, cream for settled,
 *  pink for anything being undone. */
const STATE_TONE: Record<EntryState, "yellow" | "cream" | "pink"> = {
  pending: "yellow",
  synced: "cream",
  voiding: "pink",
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
      <Card tone="yellow" border={3} radius={16} lift="xs" className="px-3 py-2.5">
        <p className="text-12 text-ink leading-snug">
          Offline storage unavailable — your logs for this session aren&rsquo;t recorded locally.
        </p>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Label size={11} as="p" className="text-rust">
        Nothing logged in this session yet.
      </Label>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => {
        const itemType = itemTypes.find((t) => t.key === entry.itemTypeKey);
        const isVoiding = entry.state === "voiding";
        return (
          <li key={entry.clientEntryId}>
            <Card
              tone="cream"
              border={4}
              radius={16}
              lift={isVoiding ? "none" : "xs"}
              className={cn("flex items-center justify-between gap-3 p-2.5", isVoiding && "sticker-off")}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {/* Screen 6 puts the time in a fixed rust column so the
                    descriptions line up down the list. */}
                <Label
                  size={9}
                  as="time"
                  dateTime={entry.occurredAt}
                  title={formatFull(entry.occurredAt)}
                  className="text-rust w-[58px] shrink-0 tabular-nums"
                >
                  {formatClock(entry.occurredAt)}
                </Label>
                <span aria-hidden="true" className="text-16">
                  {itemType?.emoji ?? "•"}
                </span>
                <span className={cn("font-display text-18 min-w-0 truncate", isVoiding && "line-through")}>
                  {itemType?.label ?? entry.itemTypeKey}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Pill tone={STATE_TONE[entry.state]}>{STATE_COPY[entry.state]}</Pill>
                {!isVoiding && !readOnly && (
                  <button
                    type="button"
                    onClick={() => void undo(entry.clientEntryId)}
                    aria-label={`Delete ${itemType?.label ?? entry.itemTypeKey} logged at ${formatFull(entry.occurredAt)}`}
                    className="font-display text-cream bg-hot-pink border-ink rounded-99 min-h-11 cursor-pointer border-3 border-solid px-3 text-14 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    Delete
                  </button>
                )}
              </span>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
