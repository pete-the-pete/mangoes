import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "./cn";

export type ButtonTone =
  | "primary" /* yellow — the default affirmative action */
  | "secondary" /* cream — lower emphasis */
  | "accent" /* turquoise — "shared/group" semantics */
  | "destructive" /* hot pink — end/close/remove */
  | "go" /* orange — GO LIVE and friends */
  | "ghost"; /* unfilled, for nav and inline actions */

export type ButtonSize = "sm" | "md" | "lg";

/** Fill, paired with the text color that stays legible on it. */
const TONE: Record<ButtonTone, string> = {
  primary: "bg-mango-yellow text-ink border-ink",
  secondary: "bg-cream text-ink border-ink",
  accent: "bg-turquoise text-ink border-ink",
  destructive: "bg-hot-pink text-cream border-ink",
  go: "bg-mango-orange text-cream border-ink",
  ghost: "bg-transparent text-ink border-transparent shadow-none",
};

/**
 * Which surface the button sits ON, not what it is made of — the sticker
 * shadow is ink against a light background and inverts to cream against a dark
 * one (screens 5 and 8). Deriving it from `tone` looks right until a yellow
 * button lands on an ink panel and its ink shadow disappears.
 */
const SHADOW_ON: Record<"light" | "dark", string> = {
  light: "shadow-ink",
  dark: "shadow-cream",
};

/**
 * Every size clears a 44px hit area — the handoff notes its 34px visual
 * controls need padded touch targets in production, and this is a phone-first
 * app where that is the difference between a tap landing and not.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 border-4 px-4 py-1.5 text-17 gap-1.5",
  md: "min-h-11 border-5 px-5 py-2 text-20 gap-2",
  lg: "min-h-14 border-6 px-7 py-3 text-26 gap-2.5",
};

const REST_SHADOW: Record<ButtonSize, string> = {
  sm: "shadow-sticker-sm",
  md: "shadow-sticker-md",
  lg: "shadow-sticker-2xl",
};

/**
 * The press: the button drops onto its own shadow. Pure CSS `:active` on
 * purpose — this is on the tap path of the core loop, where a React state
 * round-trip would put a render between the finger and the feedback.
 *
 * `active:translate-y-*` distances are matched to each size's rest shadow so
 * the button lands flush rather than hovering or overshooting.
 */
const PRESS: Record<ButtonSize, string> = {
  sm: "active:translate-y-[3px] active:shadow-sticker-xs",
  md: "active:translate-y-[4px] active:shadow-sticker-xs",
  lg: "active:translate-y-[5px] active:shadow-sticker-sm",
};

const BASE =
  "font-display inline-flex items-center justify-center rounded-99 border-solid " +
  "cursor-pointer select-none transition-[transform,box-shadow] duration-75 ease-out " +
  "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

interface CommonProps {
  tone?: ButtonTone;
  size?: ButtonSize;
  /** The surface underneath. Flips the sticker shadow to cream. */
  on?: "light" | "dark";
  /** Stretch to fill its container — pinned CTAs and full-width toggles. */
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  tone = "primary",
  size = "md",
  on = "light",
  block = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        BASE,
        SIZE[size],
        TONE[tone],
        REST_SHADOW[size],
        SHADOW_ON[on],
        PRESS[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export type ButtonLinkProps = CommonProps & {
  href: string;
  "aria-label"?: string;
};

/**
 * Same treatment for navigation. A link is not a button: routing through
 * `next/link` keeps prefetch, middle-click and "open in new tab" working,
 * which an onClick+router.push button silently breaks.
 */
export function ButtonLink({
  tone = "primary",
  size = "md",
  on = "light",
  block = false,
  className,
  children,
  href,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        BASE,
        SIZE[size],
        TONE[tone],
        REST_SHADOW[size],
        SHADOW_ON[on],
        PRESS[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
