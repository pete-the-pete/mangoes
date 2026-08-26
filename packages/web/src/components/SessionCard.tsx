import type { CycleStatus } from "core";

export interface SessionCardProps {
  name: string;
  status: CycleStatus;
  isOverdue: boolean;
  window: string;
  itemEmoji: string[];
}

const STATUS_STYLES: Record<CycleStatus, string> = {
  live: "bg-green-100 text-green-800",
  scheduled: "bg-gray-100 text-gray-700",
  closed: "bg-gray-200 text-gray-500",
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  closed: "Closed",
};

/**
 * Purely presentational — no hooks, no "use client" — so it can render from
 * both a server component (the browsable /sessions and group roster pages)
 * and a client component (SessionChooser). Functional Tailwind only; v0.4
 * re-skins this file without touching any caller.
 */
export function SessionCard({ name, status, isOverdue, window, itemEmoji }: SessionCardProps) {
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded border border-gray-200 bg-white p-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-gray-900">{name}</span>
        <span className="text-xs text-gray-500">{window}</span>
      </div>
      <div className="flex items-center gap-2">
        {itemEmoji.length > 0 && (
          <span aria-hidden="true" className="text-lg">
            {itemEmoji.join(" ")}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
          {STATUS_LABEL[status]}
          {isOverdue && status === "live" ? " · overdue" : ""}
        </span>
      </div>
    </div>
  );
}
