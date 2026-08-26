import Link from "next/link";

/**
 * The signed-out landing page. The product is invite-only, so there is
 * nothing here to market — this exists so a signed-out visitor (or an
 * offline-cached shell, see public/sw.js) gets a page instead of an abrupt
 * redirect, with a way into /sign-in.
 *
 * Also precached under /offline for the service worker's navigation
 * fallback — keep this component free of auth/data dependencies so both
 * routes stay static.
 */
export function Splash() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-orange-400 via-rose-400 to-teal-600 px-6 text-center">
      <span className="text-[9rem] leading-none drop-shadow-lg sm:text-[13rem]" role="img" aria-label="mango">
        🥭
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-white drop-shadow sm:text-3xl">
        Mango Tracker
      </h1>
      <p className="text-lg font-medium text-white/90">Coming soon</p>
      <Link
        href="/sign-in"
        className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-teal-700 shadow hover:bg-white/90"
      >
        Sign in
      </Link>
    </div>
  );
}
