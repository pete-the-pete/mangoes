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
  const hasSeenFirstPending = useRef(false);

  // `state.pending` only ever grows because THIS device queued a log or void
  // (see client.ts: SSE/delta pulls only ever shrink it via dropConfirmed) —
  // so a new "log" op appearing here is always this device's own tap, never
  // another participant's. Diffing against the previous render's ids finds
  // it without needing `log()` to hand back a clientEntryId it doesn't have.
  // Guarded on `hasSeenFirstPending` so a pre-existing offline queue from a
  // past session doesn't pop a toast on mount.
  useEffect(() => {
    const currentIds = new Set(state.pending.map((op) => op.clientEntryId));
    if (hasSeenFirstPending.current) {
      let latest: { clientEntryId: string; itemTypeKey: string } | undefined;
      for (const op of state.pending) {
        if (op.kind === "log" && op.itemTypeKey && !prevPendingIds.current.has(op.clientEntryId)) {
          // Keep overwriting: a rapid double-tap queues two new ops in one
          // render, and the toast should track the most recent tap, not the
          // first one it happens to see.
          latest = { clientEntryId: op.clientEntryId, itemTypeKey: op.itemTypeKey };
        }
      }
      if (latest) {
        const itemType = itemTypes.find((t) => t.key === latest!.itemTypeKey);
        setToast({
          key: latest.clientEntryId,
          label: itemType ? `${itemType.emoji} ${itemType.label} +1` : "Logged",
        });
      }
    }
    hasSeenFirstPending.current = true;
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
    void log(itemTypeKey, me).catch(() => {});
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pb-20">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{session.name}</h1>
          <Link href="/sessions" className="text-xs text-gray-500 hover:underline">
            Switch session
          </Link>
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
