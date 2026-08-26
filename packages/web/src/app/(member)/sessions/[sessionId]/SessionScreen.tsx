"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { groupTotal, subjectTotal } from "core";
import { useSession } from "@/lib/sync/useSession";
import { rejectionMessage } from "@/lib/appendOps";
import type { MemberSessionJson } from "@/lib/memberSessions";
import { initialTapToastBookkeeping, pickTapToast, type TapToastBookkeeping } from "@/lib/tapToast";
import { TapTarget, pickLayout, layoutContainerClass } from "@/components/TapTarget";
import { SessionTabs } from "@/components/SessionTabs";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
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
   * True when `me` is not in `participants` — reachable only through
   * `requireCycleParticipant`'s escape hatches (the platform owner, or an
   * admin of this session's group), never for an actual participant. Those
   * hatches exist so someone can look at a session, not so they can log into
   * one they were never added to: a tap here would credit a subject with no
   * leaderboard row, manufacturing an extra, unexplained contributor to
   * Total. Read-only disables every tap target and the undo toast; the data
   * itself stays fully visible.
   */
  readOnly: boolean;
  /**
   * Where this session's admin screen lives, for a viewer who administers its
   * group — otherwise undefined and no tab renders.
   *
   * A group admin used to have only the admin screen: sessions opened into the
   * settings form and the log-for-anyone control, with no route to the screen
   * everyone else in the group is looking at. This is the door between the two,
   * and the admin page has the matching one back.
   */
  adminHref?: string | undefined;
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
export function SessionScreen({
  session,
  itemTypes,
  participants,
  me,
  readOnly,
  adminHref,
}: SessionScreenProps) {
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
    <div className="bg-cream relative flex flex-1 flex-col gap-4 overflow-hidden px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      {/* Screen 1's slow sunburst, anchored below centre. Decorative, behind
          the reduced-motion gate, and transform-only so it composites. */}
      <div
        aria-hidden="true"
        className="animate-spin-rays pointer-events-none absolute top-[55%] left-1/2 -z-10 aspect-square w-[200vmax] -translate-x-1/2 -translate-y-1/2 opacity-[.07] will-change-transform"
        style={{
          background: "repeating-conic-gradient(from 0deg, #10312B 0deg 9deg, transparent 9deg 18deg)",
        }}
      />

      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-1.5">
            {/* The session chip: ink pill, pulsing turquoise dot when live. */}
            <Pill tone="ink" className="max-w-full">
              {!closed && (
                <span aria-hidden="true" className="bg-turquoise animate-pulse-dot size-2.5 shrink-0 rounded-full" />
              )}
              <span className="truncate">{session.name}</span>
              <span className="text-mango-yellow shrink-0">{closed ? "· Closed" : "· Live"}</span>
            </Pill>
            <h1 className="sr-only">{session.name}</h1>
          </span>
          <SyncBadge pendingCount={state.pending.length} online={state.online} degraded={state.degraded} />
        </div>

        <SessionTabs
          sessionId={session.id}
          groupId={session.groupId}
          active="log"
          adminHref={adminHref}
        />
        <Link
          href="/sessions"
          className="font-display text-rust self-start text-15 underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Switch session
        </Link>
      </header>

      {readOnly && (
        <Card tone="turquoise" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p className="text-12 text-ink leading-snug">
            You&rsquo;re viewing this session without being a participant, so logging is turned off here.
          </p>
        </Card>
      )}

      {session.isOverdue && !closed && (
        <Card tone="yellow" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p className="text-12 text-ink leading-snug">
            This session&rsquo;s end time has passed — an admin can close it.
          </p>
        </Card>
      )}

      {closed && (
        <Card tone="pink" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p className="text-12 text-cream leading-snug">
            This session is closed — {rejectionMessage("cycle_closed")}.
          </p>
        </Card>
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
