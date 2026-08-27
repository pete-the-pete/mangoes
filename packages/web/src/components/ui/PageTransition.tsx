"use client";

import type { ReactNode } from "react";
import { m } from "motion/react";

/**
 * The whole-page entrance, one per navigation.
 *
 * Used from `template.tsx` rather than `layout.tsx` — that is the entire reason
 * this works. Next remounts a template on every navigation and keeps a layout
 * mounted, so a layout would run this once per session and never again.
 *
 * Enter only, no exit. AnimatePresence can't hold the outgoing page in an App
 * Router navigation: the old segment is gone by the time the new one renders.
 * The outgoing half of the transition is the loading.tsx skeleton, which is why
 * those two were designed together.
 *
 * Deliberately quicker and shorter-travelling than Stagger's rows: this moves
 * the entire viewport's worth of content, where the same distance that reads as
 * lively on a card reads as sluggish on a page.
 *
 * Reduced motion comes from the root layout's MotionConfig, not a branch here —
 * see the note in Stagger for why branching the tree on that hook is a
 * hydration bug.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <m.div
      className="flex flex-1 flex-col"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.9, 0.3, 1] }}
    >
      {children}
    </m.div>
  );
}
