import Link from "next/link";
import { cn } from "./ui/cn";

export interface SessionTabsProps {
  sessionId: string;
  groupId: string;
  /** Which tab is the page being rendered. */
  active: "log" | "logs";
  /**
   * This session's admin screen, for a viewer who administers its group —
   * otherwise undefined and the fourth tab doesn't render. See
   * `canManageCohort`: the page decides, and the admin route re-checks.
   */
  adminHref?: string | undefined;
}

const TAB = "font-display flex flex-1 items-center justify-center py-2";
const INACTIVE =
  "border-ink border-l-4 border-solid opacity-55 focus-visible:opacity-100 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-ink";

/**
 * Screen 1's tab bar. Extracted from SessionScreen when the admin tab made it
 * conditional — four labels don't fit where three did, and this pill has no
 * overflow behaviour to fall back on, so the type steps down to 15 when the
 * fourth cell is present. Measured at 390px, not guessed.
 *
 * Presentational and hook-free, so `/design` can render both widths without
 * auth or a seeded database.
 */
export function SessionTabs({ sessionId, groupId, active, adminHref }: SessionTabsProps) {
  const size = adminHref ? "text-15" : "text-17";
  const cell = cn(TAB, size);

  return (
    <nav className="border-ink bg-cream rounded-99 flex items-stretch overflow-hidden border-4 border-solid">
      {active === "log" ? (
        <span className={cn(cell, "text-ink bg-mango-yellow")}>Log</span>
      ) : (
        <Link href={`/sessions/${sessionId}`} className={cn(cell, INACTIVE, "border-l-0")}>
          Log
        </Link>
      )}

      {active === "logs" ? (
        <span className={cn(cell, "text-ink bg-mango-yellow border-ink border-l-4 border-solid")}>
          Your logs
        </span>
      ) : (
        <Link href={`/sessions/${sessionId}/logs`} className={cn(cell, INACTIVE)}>
          Your logs
        </Link>
      )}

      <Link href={`/groups/${groupId}`} className={cn(cell, INACTIVE)}>
        Group
      </Link>

      {adminHref && (
        <Link href={adminHref} className={cn(cell, INACTIVE)}>
          Admin
        </Link>
      )}
    </nav>
  );
}
