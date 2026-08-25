"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ItemType } from "core";

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
        className="w-56 rounded border border-gray-300 px-2 py-1 text-sm"
      />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-gray-500">
            <th className="py-2 font-medium">Emoji</th>
            <th className="font-medium">Label</th>
            <th className="font-medium">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.key} className="border-b">
              <td className="py-2 text-lg">{item.emoji}</td>
              <td>
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
                  className="w-full rounded border border-gray-300 px-2 py-1"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={item.enabled}
                  aria-label={`${item.label} enabled`}
                  onChange={(e) => patch(item.key, { enabled: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && (
        <p className="text-sm text-gray-500">
          {initialItemTypes.length === 0
            ? "The catalog is empty — run `npm run seed -w web` (deploys run it automatically)."
            : "No item types match that filter."}
        </p>
      )}
    </div>
  );
}
