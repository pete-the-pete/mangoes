"use client";

import { useEffect } from "react";
import { Card } from "./ui/Card";
import { Label } from "./ui/Label";

export interface UndoToastProps {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}

const VISIBLE_MS = 5000;

/**
 * Appears after each tap for ~5s with a single Undo action. The caller
 * routes `onUndo` to `undo(clientEntryId)` — this component doesn't need to
 * know (and doesn't) whether that resolves as a local delete or a queued
 * void; both are the same button here.
 *
 * The parent remounts this with a fresh `key` per tap (see SessionScreen),
 * so the mount-once timer below is exactly "5s from this toast appearing" —
 * no dependency on `onDismiss`'s identity is needed since the whole
 * component is torn down and recreated for the next toast.
 *
 * The handoff has no undo design; screen 2's ink callback card is the nearest
 * thing, so this borrows it. `animate-pop-in` rather than a motion component:
 * the toast fires on every tap in the core loop, and a CSS animation costs
 * nothing per tap.
 */
export function UndoToast({ label, onUndo, onDismiss }: UndoToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, []);

  return (
    <div
      role="status"
      className="animate-pop-in pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex justify-center px-4"
    >
      <Card
        tone="ink"
        border={4}
        radius={22}
        lift="sm"
        className="pointer-events-auto flex items-center gap-4 py-2 pr-2 pl-4"
      >
        <span className="font-display text-cream text-19">{label}</span>
        <button
          type="button"
          onClick={() => {
            onUndo();
            onDismiss();
          }}
          className="font-display text-ink bg-mango-yellow border-ink rounded-99 min-h-11 cursor-pointer border-3 border-solid px-4 text-17 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cream"
        >
          Undo
        </button>
      </Card>
    </div>
  );
}
