"use client";

import type { ItemTypeOption } from "./SessionForm";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { cn } from "@/components/ui/cn";

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
      <Card tone="yellow" border={4} radius={16} lift="xs" className="px-3 py-2.5">
        <p className="text-12 text-ink leading-snug">
          No item types are enabled. A Super Admin must enable at least one on the Item types page
          before a session can be created.
        </p>
      </Card>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-1">
        <Label size={10} className="text-rust">
          What are we counting? (tap)
        </Label>
      </legend>
      <div className="flex flex-wrap gap-2.5">
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
              // Screen 4's multi-select item pills: selected is filled and
              // raised, unselected uses the shared pressed-down off-state.
              className={cn(
                "font-display border-ink rounded-99 text-22 min-h-11 cursor-pointer border-4 border-solid px-4",
                "transition-[transform,box-shadow,opacity] duration-75 ease-out",
                "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink",
                "disabled:cursor-not-allowed",
                isSelected
                  ? "bg-mango-orange shadow-sticker-sm shadow-ink"
                  : "bg-white sticker-off",
              )}
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
