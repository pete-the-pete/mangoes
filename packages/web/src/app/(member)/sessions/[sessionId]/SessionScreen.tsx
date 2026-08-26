"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { groupTotal, subjectTotal } from "core";
import { useSession } from "@/lib/sync/useSession";
import { rejectionMessage } from "@/lib/appendOps";
import type { MemberSessionJson } from "@/lib/memberSessions";
import { TapTarget, pickLayout, layoutContainerClass } from "@/components/TapTarget";
import { Leaderboard, type LeaderboardItemType, type LeaderboardParticipant } from "@/components/Leaderboard";
import { SyncBadge } from "@/components/SyncBadge";
import { UndoToast } from "@/components/UndoToast";

export interface SessionScreenProps {
  session: MemberSessionJson;
  itemTypes: LeaderboardItemType[];
  participants: LeaderboardParticipant[];
  /** The signed-in member's own id — a member always logs for themselves. */
  me: string;
}

interface ToastState {
  /** Also the outbox clientEntryId `undo` targets — see the effect below. */
  key: string;
  label: string;
}

/**
 * The screen the product exists for. Everything else in this milestone is
 * scaffolding for this one.
 */
export function SessionScreen({ session, itemTypes, participants, me }: SessionScreenProps) {
  const { state, displayed, log, undo } = useSession(session.id, me);
  const [toast, setToast] = useState<ToastState | null>(null);
  const prevPendingIds = useRef<Set<string>>(new Set());
  // Counts taps made through THIS component that are still owed a toast.
  // `state.pending` also grows from causes that are NOT a fresh tap deserving
  // a toast — most notably the initial `refreshPending()` on mount replaying
  // a pre-existing offline queue from a past visit to this session. A boolean
  // "have we seen the first pending snapshot yet" guard doesn't distinguish
  // those cases: the mount's own `readAggregate` -> `refreshPending` ->
  // `emit()` sequence fires the effect a SECOND time (first with the initial
  // empty state, then again once the store's persisted pending list loads),
  // and by then the guard would already be flipped, popping a toast (and
  // arming Undo) for an old tap nobody just made. Counting only taps this
  // component itself initiated avoids that regardless of how many times the
  // effect fires before or after a real tap.
  const expectedToasts = useRef(0);

  // `state.pending` only ever grows because THIS device queued a log or void
  // (see client.ts: SSE/delta pulls only ever shrink it via dropConfirmed) —
  // so a new "log" op appearing here is always this device's own doing, but
  // not always a tap made just now (see expectedToasts above). Diffing
  // against the previous render's ids finds WHICH op is new, without needing
  // `log()` to hand back a clientEntryId it doesn't have; expectedToasts
  // decides WHETHER that new op is owed a toast.
  useEffect(() => {
    const currentIds = new Set(state.pending.map((op) => op.clientEntryId));
    let latest: { clientEntryId: string; itemTypeKey: string } | undefined;
    for (const op of state.pending) {
      if (op.kind === "log" && op.itemTypeKey && !prevPendingIds.current.has(op.clientEntryId)) {
        // Keep overwriting: a rapid double-tap queues two new ops in one
        // render, and the toast should track the most recent tap, not the
        // first one it happens to see.
        latest = { clientEntryId: op.clientEntryId, itemTypeKey: op.itemTypeKey };
      }
    }
    if (latest && expectedToasts.current > 0) {
      expectedToasts.current -= 1;
      const itemType = itemTypes.find((t) => t.key === latest!.itemTypeKey);
      setToast({
        key: latest.clientEntryId,
        label: itemType ? `${itemType.emoji} ${itemType.label} +1` : "Logged",
      });
    }
    prevPendingIds.current = currentIds;
  }, [state.pending, itemTypes]);

  const closed = session.status === "closed";
  const layout = pickLayout(itemTypes.length);

  function handleTap(itemTypeKey: string) {
    if (closed) return;
    if (state.degraded) {
      // No offline queue to fall back on — POST directly. This tap won't
      // show an undo toast (there's no local outbox row to target) and the
      // count won't move until the next delta pull/SSE push; SyncBadge's
      // degraded copy says so.
      void fetch(`/api/sessions/${session.id}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ops: [
            {
              clientEntryId: crypto.randomUUID(),
              kind: "log",
              itemTypeKey,
              occurredAt: new Date().toISOString(),
            },
          ],
        }),
      }).catch(() => {
        /* best-effort; the member gets no local record this failed while degraded */
      });
      return;
    }
    // log()/undo() reject on enqueueLog's validation (empty itemTypeKey /
    // subjectUserId) — not expected here since itemTypeKey always comes from
    // this session's own catalog, but caught per the hook's contract.
    // Incremented optimistically and decremented back on failure so a
    // rejected tap (no new pending op ever appears) can't leave the counter
    // permanently off by one, which would otherwise pop a toast for some
    // unrelated later change to `state.pending`.
    expectedToasts.current += 1;
    void log(itemTypeKey, me).catch(() => {
      expectedToasts.current -= 1;
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold">{session.name}</h1>
          <nav className="flex gap-3 text-xs text-gray-500">
            <Link href="/sessions" className="hover:underline">
              Switch session
            </Link>
            <Link href={`/sessions/${session.id}/logs`} className="hover:underline">
              Your logs
            </Link>
            <Link href={`/groups/${session.groupId}`} className="hover:underline">
              Group
            </Link>
          </nav>
        </div>
        <SyncBadge pendingCount={state.pending.length} online={state.online} degraded={state.degraded} />
      </header>

      {session.isOverdue && !closed && (
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">
          This session&rsquo;s end time has passed — an admin can close it.
        </p>
      )}

      {closed && (
        <p className="rounded bg-gray-100 p-2 text-sm text-gray-600">
          This session is closed — {rejectionMessage("cycle_closed")}.
        </p>
      )}

      <div className={layoutContainerClass(itemTypes.length)}>
        {itemTypes.map((t) => (
          <TapTarget
            key={t.key}
            emoji={t.emoji}
            label={t.label}
            mine={subjectTotal(displayed, me, t.key)}
            group={groupTotal(displayed, t.key)}
            size={layout}
            disabled={closed}
            onTap={() => handleTap(t.key)}
          />
        ))}
      </div>

      <Leaderboard itemTypes={itemTypes} participants={participants} aggregate={displayed} me={me} />

      {toast && (
        <UndoToast
          key={toast.key}
          label={toast.label}
          onUndo={() => void undo(toast.key)}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
