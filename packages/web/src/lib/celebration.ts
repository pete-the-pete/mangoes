/**
 * The celebration that fires on every log — the "delight on log" the handoff
 * calls the retention mechanic rather than decoration (docs/design/handoff.md:20).
 *
 * Pure functions only, no React. Two reasons: the repo's test setup is node-env
 * with no DOM, so pure functions are the only thing that can be unit-tested
 * (same pattern as `pickLayout` and `pickTapToast`); and randomness has to be
 * injectable or none of this is testable at all.
 *
 * The animation itself is CSS — every keyframe already exists in globals.css,
 * ported from the prototype with the handoff's exact easings. This module only
 * decides *which* effect and *where* each particle goes.
 */

export type CelebrationEffect = "rocket" | "confetti" | "clash";

export const CELEBRATION_EFFECTS: readonly CelebrationEffect[] = [
  "rocket",
  "confetti",
  "clash",
];

/** The word mark that fires alongside every effect (handoff.md:218). */
export const CELEBRATION_WORDS: Record<CelebrationEffect, string> = {
  rocket: "BLAST OFF!!",
  confetti: "MANGO RAIN!!",
  clash: "KA-CHUNK!!",
};

/**
 * How long the whole effect window lasts before state clears.
 *
 * 1500ms is from the handoff, and it is deliberately longer than the longest
 * single animation (word-out at 1200ms) so nothing is cut off mid-flight.
 */
export const CELEBRATION_MS = 1500;

/** Injectable for tests; matches Math.random's [0, 1) contract. */
export type RandomSource = () => number;

/**
 * Picks one of the three effects, or honours a forced override.
 *
 * The override exists for QA and for the /design gallery, where cycling through
 * all three deterministically is the whole point — the prototype has the same
 * escape hatch. An unrecognised value falls back to random rather than throwing:
 * this sits on the tap path, and a bad query param must never cost someone
 * their log.
 */
export function pickEffect(
  random: RandomSource = Math.random,
  forced?: string | null,
): CelebrationEffect {
  if (forced && (CELEBRATION_EFFECTS as readonly string[]).includes(forced)) {
    return forced as CelebrationEffect;
  }
  const index = Math.floor(random() * CELEBRATION_EFFECTS.length);
  // Math.random() is [0, 1) so this can't overflow, but a supplied source that
  // returns exactly 1 would land one past the end. Clamp rather than trust it.
  return CELEBRATION_EFFECTS[Math.min(index, CELEBRATION_EFFECTS.length - 1)]!;
}

export interface CelebrationParticle {
  /** Stable within one burst — index is fine, the array is never reordered. */
  id: number;
  /** Horizontal travel, px. */
  dx: number;
  /** Vertical travel, px. Biased upward so the mass arcs before falling. */
  dy: number;
  /** Total spin over the flight, deg. */
  rot: number;
  /** Glyph size, px. */
  size: number;
  /** Flight time, seconds. */
  duration: number;
  /** Stagger, seconds. */
  delay: number;
}

/** Particle count for a confetti burst (handoff.md:215). */
export const PARTICLE_COUNT = 34;

/**
 * The 34-particle confetti burst.
 *
 * Every range here is from the handoff and was tuned in the prototype, so treat
 * the magic numbers as specified rather than arbitrary. The one that looks like
 * a typo but isn't: `dy` subtracts 80px *after* the polar conversion, biasing
 * the whole cloud upward so it arcs before falling instead of expanding evenly
 * like a ring.
 */
export function generateParticles(
  random: RandomSource = Math.random,
): CelebrationParticle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, id) => {
    const angle = random() * Math.PI * 2;
    const distance = 130 + random() * 260;
    return {
      id,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 80,
      rot: Math.round(random() * 900 - 450),
      size: 18 + random() * 34,
      duration: 0.8 + random() * 0.5,
      delay: random() * 0.18,
    };
  });
}
