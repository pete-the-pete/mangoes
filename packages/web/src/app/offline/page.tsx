import { Splash } from "../Splash";

/**
 * A stable, static URL for the service worker's offline navigation fallback
 * (public/sw.js). "/" is auth-dependent (it redirects a signed-in member to
 * their current session) and must never be precached as the offline shell —
 * an offline visitor would get a stale snapshot of whichever auth/redirect
 * state happened to be current when the shell was installed. This route has
 * no such state: it always renders the same signed-out splash, so caching it
 * is safe regardless of who is offline or what they were looking at.
 */
export default function OfflinePage() {
  return <Splash />;
}
