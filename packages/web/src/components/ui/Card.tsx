import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Every surface in this design is an outlined sticker: a solid `ink` border
 * and a hard, zero-blur offset shadow. There are no borderless cards
 * (docs/design/handoff.md).
 */
export type CardTone =
  | "cream"
  | "ink"
  | "ink-deep"
  | "yellow"
  | "turquoise"
  | "pink"
  | "orange"
  | "white";

export type CardLift = "none" | "xs" | "sm" | "md" | "lg";

export interface CardProps {
  tone?: CardTone;
  /**
   * Which surface this card sits ON, not what it is made of. The sticker
   * shadow is ink against a light background and inverts to cream against a
   * dark one (screens 5 and 8) — so the surroundings decide it, not the fill.
   * Getting this from `tone` instead looks right until you put an ink card on
   * a cream page and the shadow vanishes into the background.
   */
  on?: "light" | "dark";
  /** Shadow depth. The handoff uses 4-7px for cards; `none` is the flat variant. */
  lift?: CardLift;
  border?: 3 | 4 | 5 | 6;
  radius?: 8 | 16 | 18 | 20 | 22 | 26 | 99;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

/** Fill, paired with the text color that stays legible on it. */
const TONE: Record<CardTone, string> = {
  cream: "bg-cream text-ink",
  white: "bg-white text-ink",
  yellow: "bg-mango-yellow text-ink",
  turquoise: "bg-turquoise text-ink",
  orange: "bg-mango-orange text-cream",
  pink: "bg-hot-pink text-cream",
  ink: "bg-ink text-cream",
  "ink-deep": "bg-ink-deep text-cream",
};

const SHADOW_ON: Record<NonNullable<CardProps["on"]>, string> = {
  light: "shadow-ink",
  dark: "shadow-cream",
};

const LIFT: Record<CardLift, string> = {
  none: "",
  xs: "shadow-sticker-xs",
  sm: "shadow-sticker-sm",
  md: "shadow-sticker-md",
  lg: "shadow-sticker-lg",
};

const BORDER: Record<NonNullable<CardProps["border"]>, string> = {
  3: "border-3",
  4: "border-4",
  5: "border-5",
  6: "border-6",
};

const RADIUS: Record<NonNullable<CardProps["radius"]>, string> = {
  8: "rounded-8",
  16: "rounded-16",
  18: "rounded-18",
  20: "rounded-20",
  22: "rounded-22",
  26: "rounded-26",
  99: "rounded-99",
};

export function Card({
  tone = "cream",
  on = "light",
  lift = "sm",
  border = 5,
  radius = 22,
  as: Tag = "div",
  className,
  children,
}: CardProps) {
  return (
    <Tag
      className={cn(
        "border-ink border-solid",
        BORDER[border],
        RADIUS[radius],
        TONE[tone],
        lift !== "none" && [LIFT[lift], SHADOW_ON[on]],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
