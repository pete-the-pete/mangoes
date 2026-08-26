import type { ReactNode } from "react";
import type { SessionListItem } from "@/lib/memberSessions";
import { Label } from "./ui/Label";

export interface SessionGroupsProps {
  live: SessionListItem[];
  scheduled: SessionListItem[];
  recent: SessionListItem[];
  /**
   * How one session renders. `/` wraps each in a button that sets the
   * current-session pointer; `/sessions` and the group roster just link. The
   * grouping, ordering and headings are identical either way, which is the
   * whole reason this exists.
   */
  renderItem: (item: SessionListItem) => ReactNode;
}

const GROUPS = [
  ["Live", "live"],
  ["Scheduled", "scheduled"],
  ["Recent", "recent"],
] as const;

/**
 * Live / Scheduled / Recent, with empty groups omitted. Extracted from the
 * two copies of `renderGroup` that had grown in SessionChooser and
 * /sessions — they were identical apart from what each wrapped a card in.
 */
export function SessionGroups({ live, scheduled, recent, renderItem }: SessionGroupsProps) {
  const byKey = { live, scheduled, recent };

  return (
    <>
      {GROUPS.map(([heading, key]) => {
        const items = byKey[key];
        if (items.length === 0) return null;
        return (
          <section key={key} className="flex flex-col gap-2.5">
            <Label size={12} as="h2" className="text-rust">
              {heading}
            </Label>
            <div className="flex flex-col gap-2.5">{items.map(renderItem)}</div>
          </section>
        );
      })}
    </>
  );
}
