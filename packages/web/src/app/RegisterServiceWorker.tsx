"use client";

import { useEffect } from "react";

// Renders nothing — registers the app-shell service worker (public/sw.js) so
// the install prompt and offline shell work. Guarded on feature support since
// not every browser (and no non-browser test environment) has
// navigator.serviceWorker.
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  return null;
}
