import type { ReactNode } from "react";
import { cn } from "./cn";

export interface PageShellProps {
  /** `narrow` is the phone-width member column; `wide` the admin one. */
  width?: "narrow" | "wide";
  /** Paints the full viewport behind the column — admin screens go dark. */
  surface?: "cream" | "ink" | "ink-deep" | "turquoise-deep" | "none";
  className?: string;
  children?: ReactNode;
}

const WIDTH = {
  narrow: "max-w-md",
  wide: "max-w-3xl",
} as const;

const SURFACE = {
  cream: "bg-cream text-ink",
  ink: "bg-ink text-cream",
  "ink-deep": "bg-ink-deep text-cream",
  "turquoise-deep": "bg-turquoise-deep text-cream",
  none: "",
} as const;

/**
 * The centered column every screen shares, replacing the ~10 hand-repeated
 * `mx-auto w-full max-w-* p-6` strings.
 *
 * The bottom padding is `pb-[max(1.5rem,env(safe-area-inset-bottom))]` rather
 * than a flat value: this is a standalone PWA with viewportFit: cover, so on a
 * notched phone the last row would otherwise sit under the home indicator.
 */
export function PageShell({
  width = "narrow",
  surface = "cream",
  className,
  children,
}: PageShellProps) {
  return (
    <div className={cn("flex flex-1 flex-col", SURFACE[surface])}>
      <div
        className={cn(
          "mx-auto flex w-full flex-1 flex-col gap-6 px-5 pt-6",
          "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          WIDTH[width],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
