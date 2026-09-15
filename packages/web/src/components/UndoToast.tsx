"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "./ui/Card";
import { Label } from "./ui/Label";

export interface UndoToastProps {
  label: string;
  /** The themed cutout belongs only to the default mango item type. */
  showMangoAnimation: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}

const VISIBLE_MS = 5000;
const UNDO_ANIMATION_MS = 3000;
const UNDO_IMAGE_SRC = "/animations/you-cannot-have-mango.png";

/**
 * Appears after each tap for ~5s with a single Undo action. The caller
 * routes `onUndo` to `undo(clientEntryId)` — this component doesn't need to
 * know (and doesn't) whether that resolves as a local delete or a queued
 * void; both are the same button here.
 *
 * The parent remounts this with a fresh `key` per tap (see SessionScreen),
 * so the mount-once timer below is exactly "5s from this toast appearing."
 * Undo replaces that timer with the shorter image-animation timer; no
 * dependency on `onDismiss`'s identity is needed since the whole component
 * is torn down and recreated for the next toast.
 *
 * The handoff has no undo design; screen 2's ink callback card is the nearest
 * thing, so this borrows it. `animate-pop-in` rather than a motion component:
 * the toast fires on every tap in the core loop, and a CSS animation costs
 * nothing per tap.
 */
export function UndoToast({ label, showMangoAnimation, onUndo, onDismiss }: UndoToastProps) {
  const [showUndoAnimation, setShowUndoAnimation] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dismissTimer.current = setTimeout(onDismiss, VISIBLE_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, []);

  function handleUndo() {
    onUndo();

    if (!showMangoAnimation) {
      onDismiss();
      return;
    }

    setShowUndoAnimation(true);

    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(onDismiss, UNDO_ANIMATION_MS);
  }

  if (showUndoAnimation) {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden px-4"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a transient local
            cutout should display at its intrinsic aspect ratio without image
            optimisation introducing a delay after the Undo tap. */}
        <img
          src={UNDO_IMAGE_SRC}
          alt=""
          className="animate-undo-rock h-auto w-auto max-h-[58vh] max-w-[min(48vw,220px)] object-contain [transform-origin:50%_100%]"
        />
      </div>
    );
  }

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
          onClick={handleUndo}
          className="font-display text-ink bg-mango-yellow border-ink rounded-99 min-h-11 cursor-pointer border-3 border-solid px-4 text-17 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-cream"
        >
          Undo
        </button>
      </Card>
    </div>
  );
}
