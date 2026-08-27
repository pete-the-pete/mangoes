"use client";

import { Children, isValidElement, type ReactNode } from "react";
import { m } from "motion/react";

export interface StaggerProps {
  /** Layout classes for the container — this element replaces the one it wraps. */
  className?: string;
  /** Seconds before the first child starts. */
  delay?: number;
  /** Seconds between consecutive children. */
  step?: number;
  children?: ReactNode;
}

/**
 * Flies a list's children in one after another and lets them click into place.
 *
 * This is the one job `motion` is here for. The celebration and every press
 * state stay CSS — they fire on the tap path, where a per-tap React render is
 * exactly what the design system's notes say to avoid — but a staggered
 * entrance needs a per-child delay computed from the child's index, which CSS
 * can only express by hand-writing a rule per position.
 *
 * A thin client wrapper around server-rendered children, deliberately. `Card`,
 * `SessionCard`, `Leaderboard` and the rest stay server components; only this
 * boundary is client, and the children pass straight through it as an opaque
 * prop. Converting the primitives themselves would drag the whole tree across.
 *
 * The overshoot on the exit curve is the "click into place" — it is the same
 * cubic-bezier(.2, 1.6, .4, 1) the design system already uses for `pop-in` and
 * the handoff's progress fill, so the motion reads as one system rather than
 * per-component invention.
 *
 * Reduced motion is handled by the `MotionConfig reducedMotion="user"` in the
 * root layout, NOT by branching here. An earlier version returned a plain
 * container for reduced-motion users and produced a hydration mismatch: the
 * value isn't known during SSR, so server and client disagreed on the DOM shape
 * itself and React threw the whole subtree away and re-rendered it. Never
 * branch the tree on that hook. MotionConfig drops the transform half and keeps
 * the opacity fade, which is the behavior we wanted anyway.
 */
export function Stagger({ className, delay = 0, step = 0.05, children }: StaggerProps) {
  const items = Children.toArray(children);

  // Safe to branch on: children are identical on server and client, unlike a
  // media query. Avoids a motion component per row for an empty list.
  if (items.length === 0) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className}>
      {items.map((child, index) => (
        <m.div
          // Prefer the child's own key so re-ordering or filtering the list
          // doesn't re-run the entrance on rows that merely moved.
          key={isValidElement(child) && child.key !== null ? child.key : index}
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            delay: delay + index * step,
            duration: 0.42,
            ease: [0.2, 1.6, 0.4, 1],
          }}
        >
          {child}
        </m.div>
      ))}
    </div>
  );
}
