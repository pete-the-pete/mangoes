import { cn } from "./cn";

export interface SkeletonProps {
  /** `bar` for text lines, `block` for a filled region, `circle` for avatars. */
  shape?: "bar" | "block" | "circle";
  /**
   * Which surface this sits ON, matching Card's prop of the same name. Ink
   * stripes disappear against the dark admin surfaces, so those pass "dark".
   */
  on?: "light" | "dark";
  className?: string;
}

const SHAPE = {
  bar: "h-4 rounded-99",
  block: "rounded-16",
  circle: "rounded-99 aspect-square",
} as const;

/**
 * The loading placeholder, shaped like the design system rather than like a
 * generic grey bar: same `rounded-*` scale as the real components, and the
 * striped `animate-shimmer` fill the handoff already specified for the progress
 * thermometer.
 *
 * Deliberately NOT wrapped in a Card. A skeleton stands in for content *inside*
 * a card, so the loading routes compose real `Card`s around these — that way the
 * borders and sticker shadows in the fallback are the actual ones, and only the
 * content is faked. A fallback built from lookalike borders drifts from the real
 * thing the moment Card changes.
 *
 * `aria-hidden` + a single labelled live region at the route level: without it a
 * screen reader announces a dozen meaningless placeholder nodes. The routes
 * using this own the announcement (see the loading.tsx files).
 */
export function Skeleton({
  shape = "bar",
  on = "light",
  className,
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "skeleton-fill animate-shimmer",
        on === "dark" && "[--skeleton-tint:var(--color-cream)]",
        SHAPE[shape],
        className,
      )}
    />
  );
}
