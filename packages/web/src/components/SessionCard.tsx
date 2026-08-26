import type { CycleStatus } from "core";
import { Card } from "./ui/Card";
import { Label } from "./ui/Label";
import { Pill } from "./ui/Pill";
import { cn } from "./ui/cn";

export interface SessionCardProps {
  name: string;
  status: CycleStatus;
  isOverdue: boolean;
  window: string;
  itemEmoji: string[];
}

/**
 * Status carries the design's color semantics: turquoise is "live/shared",
 * cream is neutral, and a closed session uses the pressed-down off-state so
 * it reads as spent rather than merely gray.
 */
const STATUS_TONE: Record<CycleStatus, "turquoise" | "cream"> = {
  live: "turquoise",
  scheduled: "cream",
  closed: "cream",
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  closed: "Closed",
};

/**
 * Purely presentational — no hooks, no "use client" — so it can render from
 * both a server component (the browsable /sessions and group roster pages)
 * and a client component (SessionChooser).
 */
export function SessionCard({ name, status, isOverdue, window, itemEmoji }: SessionCardProps) {
  const closed = status === "closed";
  return (
    <Card
      tone="cream"
      lift={closed ? "none" : "sm"}
      radius={20}
      border={4}
      className={cn(
        "flex w-full items-center justify-between gap-3 p-3.5 text-left",
        closed && "sticker-off",
      )}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-display text-20 truncate">{name}</span>
        <Label size={10} className="text-rust">
          {window}
        </Label>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {itemEmoji.length > 0 && (
          <span aria-hidden="true" className="text-18">
            {itemEmoji.join(" ")}
          </span>
        )}
        <Pill tone={STATUS_TONE[status]}>
          {STATUS_LABEL[status]}
          {isOverdue && status === "live" ? " · overdue" : ""}
        </Pill>
      </span>
    </Card>
  );
}
