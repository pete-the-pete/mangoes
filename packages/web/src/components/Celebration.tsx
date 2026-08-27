"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import {
  CELEBRATION_MS,
  CELEBRATION_WORDS,
  generateParticles,
  pickEffect,
  type CelebrationEffect,
  type CelebrationParticle,
} from "@/lib/celebration";

interface CelebrationState {
  effect: CelebrationEffect;
  particles: CelebrationParticle[];
  /** Bumped per fire so React remounts the nodes and CSS restarts the keyframes. */
  key: number;
}

export interface CelebrationController {
  /** Fire a celebration. Safe to call on every tap, including mid-flight. */
  fire: () => void;
  state: CelebrationState | null;
  reduced: boolean;
}

/**
 * Owns the celebration's transient state and its 1.5s teardown.
 *
 * `fire()` is deliberately fire-and-forget and does no async work: the handoff
 * is explicit that effects must never block or delay the count increment
 * (handoff.md:220), and the count is already moving from the optimistic
 * IndexedDB path before this is ever called.
 *
 * Re-firing mid-flight replaces the in-flight effect rather than queueing.
 * Rapid tapping is the core loop working as intended, and a queue would run
 * celebrations long after the taps that earned them.
 */
export function useCelebration(forced?: string | null): CelebrationController {
  const [state, setState] = useState<CelebrationState | null>(null);
  // null until hydration resolves the media query; only `true` means reduce.
  const reduced = useReducedMotion() === true;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextKey = useRef(0);

  const fire = useCallback(() => {
    const effect = pickEffect(Math.random, forced);
    nextKey.current += 1;
    setState({
      effect,
      // Under reduced motion the particles are never rendered, so don't spend
      // 34 iterations of trig generating them (handoff.md:220 — the reduced
      // variant is flash and word mark only).
      particles: reduced || effect !== "confetti" ? [] : generateParticles(),
      key: nextKey.current,
    });

    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setState(null), CELEBRATION_MS);
  }, [forced, reduced]);

  // A tap immediately before unmount would otherwise set state on a gone
  // component — and in dev's StrictMode double-mount, leak a stray timer.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  return { fire, state, reduced };
}

/**
 * The full-screen celebration overlay.
 *
 * Screen-centred for every layout. The handoff only ever drew the single-hero
 * case, but `pickLayout()` renders 2-4 and 5+ item types as grids — anchoring
 * the rocket to a tapped tile would put it off-centre and make the flash and
 * word mark, which are screen-centred by definition, disagree with it. The
 * tapped tile gets its own local pop instead (see TapTarget).
 *
 * `pointer-events-none` is load-bearing, not tidiness: this sits above the tap
 * target for 1.5s, and without it every celebration would eat the next tap.
 */
export function CelebrationLayer({ state, reduced }: { state: CelebrationState | null; reduced: boolean }) {
  if (!state) {
    return null;
  }

  const { effect, particles, key } = state;

  return (
    <div
      key={key}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {/* Full-bleed cream flash. Fires for every effect, reduced or not. */}
      <div className="bg-cream animate-flash-bg absolute inset-0" />

      {!reduced && effect === "confetti" &&
        particles.map((p) => (
          <span
            key={p.id}
            className="absolute top-1/2 left-1/2 leading-none opacity-0 will-change-transform"
            style={{
              fontSize: `${p.size}px`,
              // The keyframe reads these three; they can't be Tailwind classes
              // because every particle has different values.
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rot}deg`,
              animation: `burst ${p.duration}s cubic-bezier(.15,.7,.3,1) ${p.delay}s forwards`,
            } as React.CSSProperties}
          >
            🥭
          </span>
        ))}

      {!reduced && effect === "rocket" && (
        <div className="animate-rocket-up absolute top-[52%] left-1/2 -ml-[46px] will-change-transform">
          <div className="text-[92px] leading-none [transform:rotate(-14deg)]">🥭</div>
          {/* The thrust. The fast 0.09s flicker is what sells it as flame
              rather than a coloured blob — see handoff.md:211. */}
          <div
            className="animate-flame absolute top-[78px] left-1/2 -ml-[22px] h-[120px] w-[44px] will-change-transform"
            style={{
              borderRadius: "50% 50% 40% 40%",
              background:
                "linear-gradient(180deg, var(--color-mango-yellow), var(--color-hot-pink) 70%, transparent)",
            }}
          />
        </div>
      )}

      {!reduced && effect === "clash" && (
        <div className="absolute top-1/2 left-1/2 h-0 w-0">
          <div className="animate-clash-l absolute -top-[60px] -left-[60px] text-[110px] leading-none will-change-transform">
            🥭
          </div>
          <div className="animate-clash-r absolute -top-[60px] -left-[60px] text-[110px] leading-none will-change-transform">
            🥭
          </div>
          {/* The impact star: a 10-point polygon rather than an SVG, so it
              inherits the design system's ink border and yellow fill directly. */}
          <div
            className="animate-star-pop bg-mango-yellow border-ink absolute -top-[130px] -left-[130px] size-[260px] border-6 border-solid opacity-0 will-change-transform"
            style={{
              clipPath:
                "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
            }}
          />
        </div>
      )}

      {/* The word mark. Like the flash, it fires in the reduced variant too —
          it communicates that the tap landed, which is information, not
          decoration. */}
      <div className="animate-word-out absolute inset-x-0 top-[34%] text-center will-change-transform">
        <span className="font-display text-mango-yellow text-stroke-7 text-[74px] leading-[0.9]">
          {CELEBRATION_WORDS[effect]}
        </span>
      </div>
    </div>
  );
}
