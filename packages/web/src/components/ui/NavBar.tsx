import type { ReactNode } from "react";
import Link from "next/link";
import { Label } from "./Label";
import { cn } from "./cn";

export interface NavBarProps {
  /** The small all-caps word at the far left — "Admin", "Mango", etc. */
  brand: string;
  /** `wide` matches PageShell's admin column, `narrow` the member one. */
  width?: "narrow" | "wide";
  children: ReactNode;
}

/**
 * Screen 1's tab-bar treatment, shared by AdminNav and MemberNav. Extracted
 * when the member side got a nav of its own: the two were going to be the same
 * dark bar with the same link styling, and a second hand-rolled copy is how
 * they drift apart.
 *
 * The top padding is `pt-[max(0.75rem,env(safe-area-inset-top))]` rather than a
 * flat value for the same reason PageShell's bottom padding is — this is a
 * standalone PWA with `viewportFit: "cover"`, so on a notched phone the links
 * would otherwise sit under the status bar.
 */
export function NavBar({ brand, width = "wide", children }: NavBarProps) {
  return (
    <nav className="bg-ink border-ink border-b-4 border-solid">
      <div
        className={cn(
          "mx-auto flex w-full items-center gap-1 px-4 pb-3 sm:gap-2 sm:px-5",
          "pt-[max(0.75rem,env(safe-area-inset-top))]",
          // A safety net, not the plan: the member bar is sized to fit a
          // 390px phone, but an admin sees one link more than a member does
          // and the labels are content. Scrolling beats wrapping into a
          // second row that pushes the page down, or clipping a link away.
          "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          width === "wide" ? "max-w-3xl" : "max-w-md",
        )}
      >
        <Label size={9} className="text-mango-yellow mr-1 hidden sm:inline">
          {brand}
        </Label>
        {children}
      </div>
    </nav>
  );
}

/**
 * Deliberately not marking an active tab: doing that needs usePathname, which
 * would make the whole nav — and every page's shell — a client component for a
 * purely decorative cue.
 */
export function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // text-15/px-2 below sm, text-17/px-3.5 above: at the full set of five
        // links the 17 never fit a 390px phone, and shrinking the type beats
        // hiding a link behind a scroll the nav gives no hint of.
        "font-display text-cream rounded-99 min-h-11 inline-flex shrink-0 items-center px-2 text-15 opacity-75 transition-opacity sm:px-3.5 sm:text-17 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-mango-yellow",
        className,
      )}
    >
      {children}
    </Link>
  );
}
