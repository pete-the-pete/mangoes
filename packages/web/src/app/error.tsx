"use client";

import { useEffect } from "react";
import { PageShell } from "@/components/ui/PageShell";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";

/**
 * The app-wide error boundary. Wraps loading.tsx, not-found.tsx, page.tsx and
 * nested layouts — but NOT the root layout, which would need global-error.tsx.
 *
 * `retry`, not `reset`: Next 16.3 stabilised `retry()`, which re-fetches the
 * segment's data and re-renders. `reset()` still exists but only clears the
 * error state without re-fetching, which for these pages — every one of them
 * data-backed — would just re-throw.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // No error reporting service wired up yet; the server digest is the only
    // handle on the real stack, which Next deliberately withholds from the
    // client bundle.
    console.error(error);
  }, [error]);

  return (
    <PageShell className="items-center justify-center text-center">
      <span aria-hidden="true" className="text-[4.5rem] leading-none">
        🙃
      </span>
      <h1 className="font-display text-42">Something went sideways</h1>
      <Label size={11} as="p" className="text-ink/70">
        That&rsquo;s on us, not you. Try again — and if it keeps happening, the
        mangoes you logged are safe either way.
      </Label>
      {error.digest && (
        <Label size={9} as="p" className="text-ink/40">
          Reference: {error.digest}
        </Label>
      )}
      <Button onClick={() => retry()}>Try again</Button>
    </PageShell>
  );
}
