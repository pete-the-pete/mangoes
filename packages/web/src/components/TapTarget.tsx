export type TapTargetSize = "large" | "grid" | "compact";

export interface TapTargetProps {
  emoji: string;
  label: string;
  mine: number;
  group: number;
  size: TapTargetSize;
  /** True once the session is closed. */
  disabled: boolean;
  onTap: () => void;
}

const SIZE_CLASSES: Record<TapTargetSize, string> = {
  large: "flex-1 flex-col gap-3 p-10 text-7xl min-h-[50vh]",
  grid: "aspect-square flex-col gap-2 p-4 text-5xl",
  compact: "aspect-square flex-col gap-1 p-2 text-3xl",
};

const LABEL_CLASSES: Record<TapTargetSize, string> = {
  large: "text-lg font-medium text-gray-700",
  grid: "text-sm font-medium text-gray-700",
  compact: "text-xs font-medium text-gray-700",
};

/**
 * How many `TapTarget`s a session's item types need decides the layout, per
 * the brief's table: 1 -> one large target; 2-4 -> a 2-column grid; 5+ -> a
 * scrollable 3-column grid. Pure and exported on its own so it's testable
 * without rendering anything.
 */
export function pickLayout(itemTypeCount: number): TapTargetSize {
  if (itemTypeCount <= 1) return "large";
  if (itemTypeCount <= 4) return "grid";
  return "compact";
}

/** The container class matching whatever `pickLayout` chose. */
export function layoutContainerClass(itemTypeCount: number): string {
  const layout = pickLayout(itemTypeCount);
  if (layout === "large") return "flex flex-1 flex-col";
  if (layout === "grid") return "grid grid-cols-2 gap-3";
  return "grid grid-cols-3 gap-2 overflow-y-auto";
}

/**
 * One tap logs +1. No confirmation, no attribution prompt, no long-press —
 * a member never chooses between crediting themselves and the group, so
 * this component has nothing to ask. `onTap` is expected to call the sync
 * hook's `log()`, which writes to IndexedDB and re-renders before any
 * network call — the count moving is this component reacting to fresh
 * `mine`/`group` props, not anything it manages itself.
 */
export function TapTarget({ emoji, label, mine, group, size, disabled, onTap }: TapTargetProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      className={`flex items-center justify-center rounded-lg border border-gray-200 bg-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]}`}
    >
      <span aria-hidden="true">{emoji}</span>
      <span className={LABEL_CLASSES[size]}>{label}</span>
      <span className="flex items-baseline gap-1.5 text-sm text-gray-500">
        <span className="font-semibold text-gray-900">{mine}</span>
        <span className="text-xs">mine</span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold text-gray-900">{group}</span>
        <span className="text-xs">total</span>
      </span>
    </button>
  );
}
