import { cn } from "./ui/cn";
import { Label } from "./ui/Label";

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
  /**
   * A counter the caller bumps on each tap of this tile, to restart its local
   * pop. Ignored by the hero size — see the note on the component.
   */
  popKey?: number;
}

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
  if (layout === "grid") return "grid grid-cols-2 gap-4";
  return "grid grid-cols-3 gap-3 overflow-y-auto";
}

/**
 * The handoff only ever draws the hero: a 268px circle with a ray ring, an
 * inner disc and a big bobbing mango. The grid sizes are ours — a session can
 * track several item types — so they reuse the same vocabulary (ink outline,
 * yellow fill, sticker underside, press-down) at a scale where a ray ring and
 * an inner disc would just be noise.
 */
const RING: Record<TapTargetSize, string> = {
  large: "size-[min(68vw,268px)] border-8",
  grid: "aspect-square w-full border-6",
  compact: "aspect-square w-full border-5",
};

const GLYPH: Record<TapTargetSize, string> = {
  large: "text-[min(30vw,118px)]",
  grid: "text-[clamp(2.5rem,14vw,4rem)]",
  compact: "text-[clamp(1.75rem,9vw,2.5rem)]",
};

/**
 * Press distances are matched to each size's resting shadow so the button
 * lands flush on its own underside rather than hovering above it.
 */
const PRESS: Record<TapTargetSize, string> = {
  large: "active:translate-y-[9px] active:shadow-tap-target-pressed",
  grid: "active:translate-y-[4px] active:shadow-sticker-xs",
  compact: "active:translate-y-[3px] active:shadow-sticker-xs",
};

const REST: Record<TapTargetSize, string> = {
  large: "shadow-tap-target",
  grid: "shadow-sticker-md shadow-ink",
  compact: "shadow-sticker-sm shadow-ink",
};

/**
 * One tap logs +1. No confirmation, no attribution prompt, no long-press —
 * a member never chooses between crediting themselves and the group, so
 * this component has nothing to ask. `onTap` is expected to call the sync
 * hook's `log()`, which writes to IndexedDB and re-renders before any
 * network call — the count moving is this component reacting to fresh
 * `mine`/`group` props, not anything it manages itself.
 *
 * The press is pure CSS `:active`. This is the tap path of the core loop,
 * where routing feedback through React state would put a render between the
 * finger and the response.
 *
 * `popKey` is how the tapped tile acknowledges itself in the grid layouts. It
 * is a counter the caller bumps, used as a React `key` so the tile remounts and
 * the CSS animation restarts — this component still holds no state, and the tap
 * path still doesn't route through a re-render of its own.
 *
 * Only the grid and compact sizes take it. The hero has the screen-centred
 * celebration landing directly on top of it, so a local pop is noise; and it is
 * the only size with looping animations inside the tile (the ray ring, the
 * bobbing glyph), which a remount would visibly restart.
 */
export function TapTarget({ emoji, label, mine, group, size, disabled, onTap, popKey }: TapTargetProps) {
  const isHero = size === "large";

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      aria-label={`Log one ${label}`}
      className={cn(
        // gap-6 on the hero, not gap-3: its underside shadow reaches 22px below
        // the circle (14px offset + 8px spread), and anything closer collides
        // with it.
        "group flex cursor-pointer flex-col items-center justify-center bg-transparent",
        isHero ? "gap-6" : "gap-3",
        "transition-[transform,box-shadow] duration-75 ease-out",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        "focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-ink rounded-full",
        isHero && "flex-1 justify-center py-3",
      )}
    >
      {isHero && (
        <span className="flex items-baseline gap-2.5">
          <span className="font-display text-ink text-[min(28vw,110px)] leading-[.78] tabular-nums [text-shadow:5px_5px_0_#FFD400]">
            {mine}
          </span>
          <span className="font-display text-ink text-20 leading-none">
            {label}
            <br />
            logged
          </span>
        </span>
      )}

      {/* The tap target proper. */}
      <span
        key={isHero ? undefined : popKey}
        className={cn(
          "border-ink bg-mango-yellow relative grid place-items-center rounded-full border-solid",
          "transition-[transform,box-shadow] duration-75 ease-out",
          RING[size],
          REST[size],
          PRESS[size],
          !isHero && popKey !== undefined && popKey > 0 && "animate-tile-pop will-change-transform",
          "group-disabled:shadow-none",
        )}
      >
        {isHero && (
          <>
            {/* Counter-rotating ray ring, then the cream inner disc over it. */}
            <span
              aria-hidden="true"
              className="animate-spin-back absolute inset-2 rounded-full opacity-30 will-change-transform"
              style={{
                background:
                  "repeating-conic-gradient(from 0deg, #10312B 0deg 7.5deg, transparent 7.5deg 15deg)",
              }}
            />
            <span
              aria-hidden="true"
              className="border-ink bg-cream absolute inset-[38px] rounded-full border-5 border-solid"
            />
          </>
        )}
        <span aria-hidden="true" className={cn("relative leading-none", GLYPH[size], isHero && "animate-bob")}>
          {emoji}
        </span>
      </span>

      {!isHero && (
        <span className="flex flex-col items-center gap-0.5">
          <span className="font-display text-ink text-17 leading-none">{label}</span>
          <span className="font-display text-ink text-15 leading-none tabular-nums">
            {mine} <span className="text-rust">/ {group}</span>
          </span>
        </span>
      )}

      {isHero && (
        <Label size={11} className="text-rust">
          {group} for the group
        </Label>
      )}
    </button>
  );
}
