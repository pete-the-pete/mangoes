import { describe, it, expect } from "vitest";
import {
  CELEBRATION_EFFECTS,
  CELEBRATION_WORDS,
  PARTICLE_COUNT,
  generateParticles,
  pickEffect,
  type RandomSource,
} from "@/lib/celebration";

/** A deterministic stand-in for Math.random that walks a fixed list. */
function sequence(values: number[]): RandomSource {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("pickEffect", () => {
  it("maps the random range evenly onto the three effects", () => {
    expect(pickEffect(() => 0)).toBe("rocket");
    expect(pickEffect(() => 0.5)).toBe("confetti");
    expect(pickEffect(() => 0.99)).toBe("clash");
  });

  it("honours a forced effect, for QA and the design gallery", () => {
    expect(pickEffect(() => 0, "clash")).toBe("clash");
    expect(pickEffect(() => 0.99, "rocket")).toBe("rocket");
  });

  it("falls back to random for an unrecognised override rather than throwing", () => {
    // This sits on the tap path — a bad query param must never cost a log.
    expect(pickEffect(() => 0, "fireworks")).toBe("rocket");
    expect(pickEffect(() => 0, null)).toBe("rocket");
    expect(pickEffect(() => 0, "")).toBe("rocket");
  });

  it("stays in range for a source that returns exactly 1", () => {
    // Math.random() never does, but an injected source might.
    expect(CELEBRATION_EFFECTS).toContain(pickEffect(() => 1));
  });

  it("has a word mark for every effect", () => {
    for (const effect of CELEBRATION_EFFECTS) {
      expect(CELEBRATION_WORDS[effect]).toBeTruthy();
    }
  });
});

describe("generateParticles", () => {
  it("makes exactly the specified number of particles with unique ids", () => {
    const particles = generateParticles(sequence([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
    expect(particles).toHaveLength(PARTICLE_COUNT);
    expect(new Set(particles.map((p) => p.id)).size).toBe(PARTICLE_COUNT);
  });

  it("keeps every value inside the handoff's ranges", () => {
    // Run against real randomness so the bounds are checked across the space,
    // not just at one sampled point.
    for (const p of generateParticles()) {
      // Distance is 130-390px, so |dx| can reach 390 and dy is that minus 80.
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(390);
      expect(p.dy).toBeGreaterThanOrEqual(-470);
      expect(p.dy).toBeLessThanOrEqual(310);
      expect(Math.abs(p.rot)).toBeLessThanOrEqual(450);
      expect(p.size).toBeGreaterThanOrEqual(18);
      expect(p.size).toBeLessThanOrEqual(52);
      expect(p.duration).toBeGreaterThanOrEqual(0.8);
      expect(p.duration).toBeLessThanOrEqual(1.3);
      expect(p.delay).toBeGreaterThanOrEqual(0);
      expect(p.delay).toBeLessThanOrEqual(0.18);
    }
  });

  it("biases the cloud upward so it arcs before falling", () => {
    // The -80px offset is the whole reason this reads as a burst rather than
    // an evenly expanding ring. Averaged over a full run it must come out
    // negative (screen coords: up is negative).
    const mean =
      generateParticles().reduce((sum, p) => sum + p.dy, 0) / PARTICLE_COUNT;
    expect(mean).toBeLessThan(0);
  });

  it("is deterministic for a given random source", () => {
    const seed = () => sequence([0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 0.77]);
    expect(generateParticles(seed())).toEqual(generateParticles(seed()));
  });
});
