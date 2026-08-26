import type { ReactNode } from "react";
import { cn } from "./cn";

export type PillTone =
  | "cream"
  | "ink"
  | "ink-deep"
  | "yellow"
  | "turquoise"
  | "pink"
  | "orange"
  | "white";

export interface PillProps {
  tone?: PillTone;
  /** `sm` is the 3px-bordered badge (roles, tags); `md` the 5px chip. */
  size?: "sm" | "md";
  /** Renders the pressed-down inactive treatment. See `sticker-off`. */
  off?: boolean;
  className?: string;
  children?: ReactNode;
}

const TONE: Record<PillTone, string> = {
  cream: "bg-cream text-ink",
  white: "bg-white text-ink",
  yellow: "bg-mango-yellow text-ink",
  turquoise: "bg-turquoise text-ink",
  orange: "bg-mango-orange text-ink",
  pink: "bg-hot-pink text-cream",
  ink: "bg-ink text-cream",
  "ink-deep": "bg-ink-deep text-cream",
};

const SIZE = {
  sm: "border-3 px-2.5 py-0.5 text-12",
  md: "border-5 px-4 py-1 text-16",
} as const;

/**
 * The rounded badge that carries status, role and tag semantics throughout the
 * design — Anton, uppercase, ink-outlined, fully rounded. Presentational only:
 * anything tappable wraps this in a Button rather than becoming one, so the
 * 44px hit area comes from the control, not the badge.
 */
export function Pill({
  tone = "cream",
  size = "sm",
  off = false,
  className,
  children,
}: PillProps) {
  return (
    <span
      className={cn(
        "font-display border-ink inline-flex items-center gap-1.5 rounded-99 border-solid whitespace-nowrap",
        SIZE[size],
        TONE[tone],
        off && "sticker-off",
        className,
      )}
    >
      {children}
    </span>
  );
}
