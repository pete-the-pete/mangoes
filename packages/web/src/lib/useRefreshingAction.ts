"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface RefreshingAction {
  /** True from the click until the refreshed server render is on screen. */
  busy: boolean;
  /**
   * Runs the mutation, then refreshes the server component that owns the data.
   * The return value is ignored — callers that need one (MembersPanel reads
   * `ok`/`body` to decide a success notice) consume it inside their own
   * callback, which keeps that work in the same transition.
   */
  run: (mutate: () => unknown) => void;
}

/**
 * The one pattern every mutation surface in the admin area uses.
 *
 * Every one of them is a client component that fetches an API route and then
 * calls `router.refresh()`, because the server component owns the list being
 * mutated. The problem was never the refresh — it was that `router.refresh()`
 * returns void and nothing awaited it, so a caller had no way to know when the
 * new data actually arrived. Surfaces that tracked a busy flag cleared it in a
 * `finally` that ran while the server was still re-rendering; surfaces that
 * didn't showed nothing at all. Either way the click felt dead.
 *
 * Wrapping the whole thing in an async transition fixes both: React keeps
 * `isPending` true for the duration of the async function AND until the
 * resulting re-render commits, so `busy` covers the entire round trip.
 *
 * `mutate` should handle its own failures the way these components already do —
 * catching into local error state. An error thrown out of here bubbles past the
 * component to the nearest error boundary and replaces the whole screen, which
 * is the wrong response to a failed role toggle.
 */
export function useRefreshingAction(): RefreshingAction {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const run = useCallback(
    (mutate: () => unknown) => {
      startTransition(async () => {
        await mutate();
        // Inside the transition, not after it: this is what extends `busy`
        // across the server re-render rather than ending at the fetch.
        router.refresh();
      });
    },
    [router],
  );

  return { busy, run };
}
