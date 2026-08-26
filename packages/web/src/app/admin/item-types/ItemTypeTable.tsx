"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ItemType } from "core";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { cn } from "@/components/ui/cn";

export function ItemTypeTable({ initialItemTypes }: { initialItemTypes: ItemType[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function patch(key: string, update: { enabled?: boolean; label?: string }) {
    setError(null);
    const res = await fetch(`/admin/api/item-types/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not update the item type");
    }
    // Refresh either way: the server component owns this list, so on success it
    // shows the write and on failure it undoes the optimistic input state.
    router.refresh();
  }

  const needle = filter.trim().toLowerCase();
  // A fixed ~130-row list: a filter box is less machinery than pagination, and
  // the whole catalog stays one scroll away.
  const rows = needle
    ? initialItemTypes.filter((item) => item.label.toLowerCase().includes(needle))
    : initialItemTypes;

  return (
    <div className="flex flex-col gap-3">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by label"
        aria-label="Filter item types by label"
        className="font-sans text-ink bg-white border-ink rounded-99 min-h-11 w-64 max-w-full border-4 border-solid px-4 text-14 outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />

      {error && (
        <Card tone="pink" border={4} radius={16} lift="xs" className="px-3 py-2.5">
          <p role="alert" className="text-12 text-cream leading-snug">
            {error}
          </p>
        </Card>
      )}

      {/* The one admin view that stays a table rather than becoming cards.
          It is a ~130-row catalog scanned by label and toggled in bulk, which
          is exactly what a dense grid is for — card rows would triple its
          height and make the filter useless. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-separate border-spacing-y-2 text-left">
          <thead>
            <tr>
              <th className="w-12 px-2">
                <Label size={9} className="text-rust">
                  Emoji
                </Label>
              </th>
              <th className="px-2">
                <Label size={9} className="text-rust">
                  Label
                </Label>
              </th>
              <th className="w-20 px-2">
                <Label size={9} className="text-rust">
                  Enabled
                </Label>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr
                key={item.key}
                className={cn(
                  "border-ink bg-cream [&>td]:border-ink [&>td]:border-y-3 [&>td]:border-solid",
                  "[&>td:first-child]:rounded-l-16 [&>td:first-child]:border-l-3",
                  "[&>td:last-child]:rounded-r-16 [&>td:last-child]:border-r-3",
                  !item.enabled && "opacity-55",
                )}
              >
                <td className="bg-cream px-2 py-1.5 text-22">{item.emoji}</td>
                <td className="bg-cream px-2 py-1.5">
                  <input
                    defaultValue={item.label}
                    maxLength={40}
                    aria-label={`Label for ${item.key}`}
                    // Saved on blur rather than per keystroke: one PATCH per edit,
                    // not one per character.
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label && label !== item.label) {
                        patch(item.key, { label });
                      }
                    }}
                    // Label text is curated by the Super Admin and shown to
                    // members verbatim, so it stays body copy rather than Anton.
                    className="font-sans text-ink border-ink/25 rounded-8 min-h-11 w-full border-2 border-solid bg-transparent px-2 text-15 font-medium outline-none focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-ink"
                  />
                </td>
                <td className="bg-cream px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    aria-label={`${item.label} enabled`}
                    onChange={(e) => patch(item.key, { enabled: e.target.checked })}
                    className="border-ink accent-mango-yellow size-7 cursor-pointer rounded-8 border-3 border-solid"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <Label size={11} as="p" className="text-rust">
          {initialItemTypes.length === 0
            ? "The catalog is empty — run `npm run seed -w web` (deploys run it automatically)."
            : "No item types match that filter."}
        </Label>
      )}
    </div>
  );
}
