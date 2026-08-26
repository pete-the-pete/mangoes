import Link from "next/link";

/**
 * The signed-out landing page. The product is invite-only, so there is
 * nothing here to market — this exists so a signed-out visitor (or an
 * offline-cached shell, see public/sw.js) gets a page instead of an abrupt
 * redirect, with a way into /sign-in.
 *
 * Also precached under /offline for the service worker's navigation
 * fallback — keep this component free of auth/data dependencies so both
 * routes stay static. That is also why the sunburst and the bob are pure
 * CSS: no hooks, no client boundary.
 *
 * Type is sized with clamp() throughout. The handoff's figures (104px title)
 * are measured off a desktop presentation canvas; this ships to a phone.
 */
export function Splash() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Screen background: the handoff's radial gradient. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(circle at 50% -10%, #FFD400 0%, #FFB300 22%, #FF7A18 46%, #FF2D6F 78%)",
        }}
      />
      {/* Slow sunburst. `transform: rotate` on its own layer — an animated
          background-position would repaint the whole area every frame. */}
      <div
        aria-hidden="true"
        className="animate-spin-rays-slow pointer-events-none absolute top-1/2 left-1/2 -z-10 aspect-square w-[180vmax] -translate-x-1/2 -translate-y-1/2 opacity-15 will-change-transform"
        style={{
          background:
            "repeating-conic-gradient(from 0deg, #10312B 0deg 9deg, transparent 9deg 18deg)",
        }}
      />

      <div className="flex flex-col items-center gap-7">
        <span
          role="img"
          aria-label="mango"
          className="animate-bob inline-block text-[clamp(6rem,34vw,11rem)] leading-none drop-shadow-[0_10px_0_rgba(16,49,43,.35)]"
        >
          🥭
        </span>

        {/* leading .92, not the handoff's .86: that figure is measured on type
            with no shadow under it. At .86 the ink text-shadow of "MANGO"
            lands on top of "TRACKER". */}
        <h1 className="font-display text-cream text-[clamp(3rem,15vw,6.5rem)] leading-[.92] [text-shadow:5px_5px_0_#10312B]">
          Mango
          <br />
          Tracker
        </h1>

        <p className="border-ink bg-turquoise text-ink font-display rounded-8 border-5 border-solid px-4 py-2.5 text-[clamp(.95rem,4.2vw,1.3rem)] leading-[1.15] shadow-sticker-diag-md shadow-ink -rotate-3">
          Tap a mango.
          <br />
          Break the internet.
        </p>

        <Link
          href="/sign-in"
          className="font-display bg-mango-yellow text-ink border-ink shadow-sticker-2xl shadow-ink rounded-99 inline-flex min-h-14 items-center justify-center border-6 border-solid px-9 text-26 transition-[transform,box-shadow] duration-75 ease-out active:translate-y-[5px] active:shadow-sticker-sm focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-cream"
        >
          Log in
        </Link>
      </div>
    </div>
  );
}
