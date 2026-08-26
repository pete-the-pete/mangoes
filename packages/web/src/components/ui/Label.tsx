import type { ElementType, ReactNode } from "react";
import { cn } from "./cn";

export interface LabelProps {
  /** Handoff label scale, in px. 9-10 is only ever used for tracked, uppercase
   *  micro-labels — never for reading copy. */
  size?: 9 | 10 | 11 | 12 | 13 | 15;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

const SIZE: Record<NonNullable<LabelProps["size"]>, string> = {
  9: "text-9 tracking-[.12em]",
  10: "text-10 tracking-[.2em]",
  11: "text-11 tracking-[.2em]",
  12: "text-12 tracking-[.16em]",
  13: "text-13 tracking-[.14em]",
  15: "text-15 tracking-[.28em]",
};

/**
 * Small text: Space Grotesk 700, uppercase, tracked wide.
 *
 * Deliberately NOT the place for anything user-entered. Uppercasing is baked
 * in here and in `font-display`, so emails, group names and free text belong
 * in plain body copy — see the note in globals.css.
 */
export function Label({ size = 11, as: Tag = "span", className, children }: LabelProps) {
  return (
    <Tag className={cn("font-sans font-bold uppercase", SIZE[size], className)}>{children}</Tag>
  );
}
