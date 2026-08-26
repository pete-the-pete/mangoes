"use client";

import { useEffect } from "react";

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
 */
export function UndoToast({ label, onUndo, onDismiss }: UndoToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, []);

  return (
    <div className="fixed inset-x-0 bottom-4 z-10 mx-auto flex w-fit items-center gap-3 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => {
          onUndo();
          onDismiss();
        }}
        className="font-semibold text-teal-300 hover:underline"
      >
        Undo
      </button>
    </div>
  );
}
