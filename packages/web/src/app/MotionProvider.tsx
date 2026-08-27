"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

/**
 * App-wide motion settings.
 *
 * `reducedMotion="user"` is the single place reduced motion is handled for
 * every `motion` component. It makes motion drop transform and layout
 * animations for users who ask for that, while keeping opacity fades — which is
 * both what the handoff wants and what the accessibility guidance actually
 * asks for (the concern is movement, not the existence of a transition).
 *
 * Doing it here rather than per-component is not just tidiness. `useReducedMotion`
 * can't be known during SSR, so any component that branches its *rendered tree*
 * on it produces a hydration mismatch and gets thrown away and re-rendered on
 * the client. MotionConfig changes only how motion animates, never what React
 * renders, so it can't cause that.
 *
 * The CSS-driven parts of the design system — the ambient loops, and the
 * celebration — are unaffected by this and handle reduced motion themselves,
 * in globals.css and useCelebration respectively.
 *
 * `LazyMotion` with `domAnimation` rather than the full `motion` component.
 * This provider is in the root layout, so it loads on every page including the
 * signed-out splash, which animates nothing. Scoping it to only the animating
 * trees was tried and measured and saved nothing — `/` serves both Splash and
 * the chooser from one route module, and `next/dynamic` on the chooser didn't
 * drop it from the initial payload either. So the lever that actually works is
 * shipping less of the library: `domAnimation` covers what this app uses
 * (opacity, transform, and their transitions) and leaves out layout animations,
 * drag and the rest. Measured cost on the landing page: ~40KB gzipped.
 *
 * `strict` makes `motion.*` throw and forces the smaller `m.*` — a guardrail so
 * a later component can't quietly reintroduce the full bundle by reaching for
 * the more obvious import.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
