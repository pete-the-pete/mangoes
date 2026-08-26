"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { groupTotal, subjectTotal } from "core";
import { useSession } from "@/lib/sync/useSession";
import { rejectionMessage } from "@/lib/appendOps";
import type { MemberSessionJson } from "@/lib/memberSessions";
import { initialTapToastBookkeeping, pickTapToast, type TapToastBookkeeping } from "@/lib/tapToast";
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
  /**
   * True when `me` is not in `participants` — reachable only through the
   * member API's platform-owner bypass (`requireCycleParticipant`'s
   * superuser escape hatch), never for an actual participant. That bypass
   * exists so an owner can look at any session, not so they can log into
   * one they were never added to: a tap here would credit a subject with no
   * leaderboard row, manufacturing an extra, unexplained contributor to
   * Total. Read-only disables every tap target and the undo toast; the data
   * itself stays fully visible.
   */
  readOnly: boolean;
}

interface ToastState {
  /** Also the outbox clientEntryId `undo` targets. */
  key: string;
  label: string;
}

/**
 * The screen the product exists for. Everything else in this milestone is
 * scaffolding for this one.
 */
export function SessionScreen({ session, itemTypes, participants, me, readOnly }: SessionScreenProps) {
  const { state, displayed, log, undo } = useSession(session.id, me);
  const [toast, setToast] = useState<ToastState | null>(null);
  const tapToastState = useRef<TapToastBookkeeping>(initialTapToastBookkeeping());

  // See `pickTapToast`'s doc comment for why this can't be a simple
  // "wasn't in the previous render's pending list" diff: an op can drop out
  // of `state.pending` (via the SSE stream's dropConfirmed) before this
  // device's own flush has durably settled it, then reappear via an
  // unrelated refreshPending() — which must never look like a second fresh
  // tap and re-arm Undo against an op the member already dealt with.
  useEffect(() => {
    if (readOnly) return; // no taps possible in read-only mode; nothing to match
    const { toast: matched, nextBookkeeping } = pickTapToast(state.pending, tapToastState.current);
    tapToastState.current = nextBookkeeping;
    if (matched) {
      const itemType = itemTypes.find((t) => t.key === matched.itemTypeKey);
      setToast({
        key: matched.clientEntryId,
        label: itemType ? `${itemType.emoji} ${itemType.label} +1` : "Logged",
      });
    }
  }, [state.pending, itemTypes, readOnly]);

  const closed = session.status === "closed";
  const disabled = closed || readOnly;
  const layout = pickLayout(itemTypes.length);

  function handleTap(itemTypeKey: string) {
    if (disabled) return;
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
    // Credited optimistically and refunded on failure so a rejected tap (no
    // new pending op ever appears) can't leave a dormant credit lying
    // around for some unrelated later change to `state.pending` to spend.
    tapToastState.current = {
      ...tapToastState.current,
      pendingTapCredits: tapToastState.current.pendingTapCredits + 1,
    };
    void log(itemTypeKey, me).catch(() => {
      tapToastState.current = {
        ...tapToastState.current,
        pendingTapCredits: tapToastState.current.pendingTapCredits - 1,
      };
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

      {readOnly && (
        <p className="rounded bg-gray-100 p-2 text-sm text-gray-600">
          You&rsquo;re viewing this session without being a participant, so logging is turned off here.
        </p>
      )}

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
            disabled={disabled}
            onTap={() => handleTap(t.key)}
          />
        ))}
      </div>

      <Leaderboard itemTypes={itemTypes} participants={participants} aggregate={displayed} me={me} />

      {!readOnly && toast && (
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
