import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system defines its own scales (docs/design/handoff.md), and
 * tailwind-merge knows nothing about them by default. Left unconfigured it
 * gets three things wrong, one of them badly:
 *
 *   twMerge("shadow-sticker-md shadow-cream") -> "shadow-cream"
 *
 * `shadow-<color>` sets only `--tw-shadow-color`; the geometry comes from
 * `shadow-sticker-*`. Unconfigured, twMerge reads both as the same group and
 * drops the geometry, so every dark surface — where the handoff inverts the
 * sticker shadow to cream — silently renders with no shadow at all.
 *
 * The other two are ordering bugs rather than deletions: `rounded-18
 * rounded-22` and `animate-bob animate-pulse-dot` both survived as pairs,
 * leaving stylesheet order to decide the winner instead of class order.
 *
 * Declaring the theme scales fixes all three. Keep these lists in step with
 * the @theme block in src/app/globals.css.
 */
// The generic declares the custom class-group ids added under `extend`;
// without it TS rejects them as unknown keys.
const twMerge = extendTailwindMerge<"text-stroke" | "sticker-off" | "skeleton-fill">({
  extend: {
    theme: {
      color: [
        "ink",
        "ink-deep",
        "cream",
        "mango-yellow",
        "mango-orange",
        "mango-orange-alt",
        "hot-pink",
        "turquoise",
        "turquoise-deep",
        "rust",
      ],
      text: [
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16",
        "17",
        "18",
        "19",
        "20",
        "21",
        "22",
        "23",
        "24",
        "26",
        "28",
        "29",
        "30",
        "34",
        "42",
        "44",
        "46",
        "48",
        "50",
        "52",
        "56",
        "62",
        "104",
        "150",
      ],
      radius: ["8", "16", "18", "20", "22", "26", "99"],
      shadow: [
        "sticker-xs",
        "sticker-sm",
        "sticker-md",
        "sticker-lg",
        "sticker-xl",
        "sticker-2xl",
        "sticker-pressed",
        "sticker-diag-sm",
        "sticker-diag-md",
        "sticker-diag-lg",
        "sticker-diag-xl",
      "tap-target",
      "tap-target-pressed",
      ],
      animate: [
        "spin-rays",
        "spin-rays-slow",
        "spin-rays-slowest",
        "spin-back",
        "pulse-dot",
        "bob",
        "bob-slow",
        "shimmer",
        "pop-in",
        "word-out",
        "rocket-up",
        "flame",
        "clash-l",
        "clash-r",
        "star-pop",
        "flash-bg",
      ],
    },
    classGroups: {
      // Custom @utility definitions in globals.css.
      "text-stroke": [{ "text-stroke": ["3", "4", "5", "6", "7", "8"] }],
      "sticker-off": ["sticker-off"],
      "skeleton-fill": ["skeleton-fill"],
    },
  },
});

/** Compose class names, with design-system-aware conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
