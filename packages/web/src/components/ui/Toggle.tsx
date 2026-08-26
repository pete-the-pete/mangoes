"use client";

import { cn } from "./cn";

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Announced to screen readers; the switch itself renders no text. */
  label: string;
  /** `lg` is screen 4's 62x34; `sm` is screen 8's 52x28. */
  size?: "sm" | "lg";
  disabled?: boolean;
  className?: string;
}

const TRACK = {
  sm: "h-7 w-13 border-3",
  lg: "h-[34px] w-[62px] border-4",
} as const;

const KNOB = {
  sm: "size-5",
  lg: "size-[22px]",
} as const;

/**
 * Travel = track width - knob width - both borders - the 2px inset on each
 * side. Derived rather than eyeballed so the knob lands flush against the
 * track's inner edge at both ends instead of drifting.
 *   sm: 52 - 20 - 6 - 4 = 22
 *   lg: 62 - 22 - 8 - 4 = 28
 */
const KNOB_ON = { sm: "translate-x-[22px]", lg: "translate-x-[28px]" } as const;

/**
 * The pill switch from screens 4 and 8. A real <button role="switch"> rather
 * than a styled checkbox: aria-checked is what makes the state audible.
 *
 * The button is the 44px tap target and the inner span is the drawn track —
 * they have to be separate elements. Putting the padding on the track itself
 * eats into its fixed height and squashes the knob.
 */
export function Toggle({ checked, onChange, label, size = "lg", disabled = false, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center bg-transparent px-1",
        "rounded-99 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span
        className={cn(
          "border-cream flex items-center rounded-99 border-solid px-[2px] transition-colors duration-150",
          TRACK[size],
          checked ? "bg-mango-yellow" : "bg-ink-deep",
        )}
      >
        <span
          className={cn(
            "border-ink block rounded-full border-2 border-solid bg-cream transition-transform duration-150 ease-out",
            KNOB[size],
            checked ? KNOB_ON[size] : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
