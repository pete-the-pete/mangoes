"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Card } from "./Card";
import { Label } from "./Label";
import { cn } from "./cn";

export interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  className?: string;
  children?: ReactNode;
}

/**
 * The one modal. Replaces the two that had grown side by side — a native
 * <dialog> in InviteUserModal and a hand-rolled fixed overlay in
 * NewGroupModal, which behaved differently under Esc and focus.
 *
 * Native <dialog> with showModal() on purpose: it brings the focus trap,
 * Esc-to-close, inertness of the background, and top-layer stacking for free.
 * Reimplementing those on a <div> is where hand-rolled overlays quietly go
 * wrong.
 */
export function Modal({ title, onClose, className, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal() throws if the dialog is already open — StrictMode's
    // double-invoked effects in dev make that reachable.
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      // `cancel` covers Esc, which otherwise closes the dialog without the
      // parent ever learning the modal is gone.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      // Clicking the backdrop hits the <dialog> itself, never its children.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "bg-transparent p-0 backdrop:bg-ink/60",
        "m-auto max-h-[90dvh] w-[min(28rem,calc(100vw-2rem))]",
      )}
    >
      <Card tone="cream" lift="lg" radius={26} className={cn("flex flex-col gap-4 p-5", className)}>
        <Label size={12} as="h2" className="text-rust">
          {title}
        </Label>
        {children}
      </Card>
    </dialog>
  );
}
