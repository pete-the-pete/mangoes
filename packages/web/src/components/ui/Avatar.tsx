import { cn } from "./cn";

export type AvatarSize = 24 | 28 | 34 | 36 | 38 | 44;

export interface AvatarProps {
  /** Clerk profile photo. Falls back to the initial when absent or broken. */
  src?: string | null;
  /** Used for the initial and, via `title`, for a hover hint. Never rendered as text. */
  name?: string | null;
  size?: AvatarSize;
  className?: string;
}

/**
 * The handoff draws avatars as flat colored circles with an Anton initial and
 * a 3px ink ring. Real users have Clerk photos, so this takes either: photo
 * when there is one, initial when there isn't, and the ink ring on both so a
 * roster of mixed avatars still reads as one row.
 *
 * The fill is derived from the name rather than stored — the design gives each
 * person a distinct color, and a stable hash gets that for free without adding
 * a color column nobody would maintain.
 */
const FILLS = [
  "bg-mango-yellow",
  "bg-turquoise",
  "bg-hot-pink",
  "bg-mango-orange",
  "bg-turquoise-deep",
] as const;

/**
 * Stable across renders and machines; the hash is only ever used to pick a
 * fill. FNV-1a plus an avalanche step rather than the usual `h * 31 + c`:
 * what matters here is that *adjacent* names in a short roster land on
 * different colors, and the classic multiply-shift barely mixes short strings
 * — "Dave"/"Sam" and "Jo"/"Tia R." collided on this exact roster.
 */
export function fillForName(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return FILLS[(hash >>> 0) % FILLS.length];
}

function initialOf(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  // Codepoint-aware: an emoji or accented first letter would otherwise be
  // sliced in half and render as a replacement glyph.
  return trimmed ? ([...trimmed][0] ?? "?").toUpperCase() : "?";
}

const SIZE: Record<AvatarSize, string> = {
  24: "size-6 text-11 border-3",
  28: "size-7 text-12 border-3",
  34: "size-[34px] text-14 border-3",
  36: "size-9 text-15 border-4",
  38: "size-[38px] text-16 border-4",
  44: "size-11 text-18 border-4",
};

export function Avatar({ src, name, size = 34, className }: AvatarProps) {
  const label = name ?? "";
  const shared = cn(
    "border-ink inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-solid",
    SIZE[size],
    className,
  );

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a small avatar off
      // Clerk's CDN isn't worth an images.remotePatterns allowlist for next/image.
      <img
        src={src}
        alt=""
        title={label || undefined}
        className={cn(shared, "bg-cream object-cover")}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      title={label || undefined}
      className={cn(
        shared,
        "font-display leading-none text-ink",
        fillForName(label),
      )}
    >
      {initialOf(label)}
    </span>
  );
}
