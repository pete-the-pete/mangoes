"use client";

import type { ItemTypeOption } from "./SessionForm";

export function EmojiPicker({
  options,
  selected,
  disabled,
  onChange,
}: {
  options: ItemTypeOption[];
  selected: string[];
  disabled: boolean;
  onChange: (keys: string[]) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
        No item types are enabled. A Super Admin must enable at least one on the
        Item types page before a session can be created.
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1">What this session tracks</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const isSelected = selected.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              title={option.label}
              aria-pressed={isSelected}
              onClick={() =>
                onChange(
                  isSelected
                    ? selected.filter((key) => key !== option.key)
                    : [...selected, option.key],
                )
              }
              className={`rounded border px-2 py-1 text-lg ${
                isSelected ? "border-black bg-gray-100" : "border-gray-200"
              }`}
            >
              <span aria-hidden="true">{option.emoji}</span>
              <span className="sr-only">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
